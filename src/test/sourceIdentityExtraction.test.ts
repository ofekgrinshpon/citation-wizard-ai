import { describe, expect, it } from "vitest";
import {
  bodyHasDocket,
  bodyHasTitle,
  docketNumberOf,
  extractIdentityEvidence,
  normalizeDocketKey,
  normalizeIdentityText,
} from "../../supabase/functions/legal-research-v2/verification/identityEvidence.ts";
import { checkIdentity } from "../../supabase/functions/legal-research-v2/verification/verify.ts";
import type { EvidenceSource } from "../../supabase/functions/legal-research-v2/types.ts";

function src(partial: Partial<EvidenceSource>): EvidenceSource {
  const text = partial.extracted_text ?? "";
  return {
    source_id: "S1",
    title: "",
    sha256: "x",
    fetch_status: "ok",
    extracted_text: text,
    text_length: text.length,
    identity_fields: { dockets: [], statutes: [], sections: [] },
    is_actual_document: true,
    origin: "web",
    fetched_at: new Date().toISOString(),
    ...partial,
  } as EvidenceSource;
}

describe("identity normalization", () => {
  it("normalizes Hebrew quote marks, maqaf and invisible characters", () => {
    expect(normalizeIdentityText('בע״מ\u200f 4623/04')).toBe('בע"מ 4623/04');
    expect(normalizeIdentityText("א\u05beב")).toBe("א-ב");
  });

  it("canonicalizes docket prefixes and numbers", () => {
    expect(normalizeDocketKey('בע"מ 4623/04')).toBe("בעמ 4623/04");
    expect(normalizeDocketKey("בע״מ 4623 / 04")).toBe("בעמ 4623/04");
    expect(docketNumberOf("מספר הליך 8206/14")).toBe("8206/14");
    expect(normalizeDocketKey("no docket here")).toBeNull();
  });
});

describe("identity matching against the acquired body", () => {
  const body = 'בבית המשפט העליון\nבע״מ 8206/14\nפלונית נ׳ פלוני\nפסק דין';

  it("confirms a docket despite quote-mark and spacing variants", () => {
    expect(bodyHasDocket(body, 'בע"מ 8206/14')).toBe(true);
    expect(bodyHasDocket(body, "8206/14")).toBe(true);
  });

  it("rejects a different docket", () => {
    expect(bodyHasDocket(body, 'בע"מ 4623/04')).toBe(false);
  });

  it("does not accept a docket whose prefix is absent near the number", () => {
    expect(bodyHasDocket("רע\"א 8206/14 עניין אחר", 'בג"ץ 8206/14')).toBe(false);
  });

  it("matches every material word of an academic title", () => {
    const article = "איזון משאבים בין בני זוג\nמאת: פלוני אלמוני\nעיוני משפט כרך ל";
    expect(bodyHasTitle(article, "איזון משאבים בין בני זוג").ok).toBe(true);
    expect(bodyHasTitle(article, "חלוקת נכסי קריירה במשפט העברי").ok).toBe(false);
  });
});

describe("extractIdentityEvidence", () => {
  it("derives a literal judgment window with deterministic signals", () => {
    const ev = extractIdentityEvidence(
      'בבית המשפט העליון\nבע״מ 8206/14\nפלונית נ׳ פלוני\n'.padEnd(1200, "ט"),
      "פלונית נ' פלוני",
    );
    expect(ev.kind).toBe("judgment");
    expect(ev.signals.some((s) => s.startsWith("docket:8206/14"))).toBe(true);
    expect(ev.signals.some((s) => s.includes("בית המשפט העליון"))).toBe(true);
    expect(ev.window.length).toBeLessThanOrEqual(900);
    expect('בבית המשפט העליון\nבע״מ 8206/14'.includes(ev.window.slice(0, 20))).toBe(true);
  });

  it("classifies academic front matter", () => {
    const ev = extractIdentityEvidence("איזון משאבים\nעיוני משפט\nhttps://doi.org/10.1234/abcd", "מאמר");
    expect(ev.kind).toBe("academic");
    expect(ev.signals.some((s) => s.startsWith("doi:"))).toBe(true);
  });
});

describe("checkIdentity", () => {
  const expected = {
    dockets: ['בע"מ 8206/14'],
    statutes: [{ statute: "חוק יחסי ממון בין בני זוג", section: "5" }],
  };

  it("passes when the body carries the claimed docket in a variant form", () => {
    const s = src({
      title: 'בע"מ 8206/14 פלונית נ\' פלוני',
      extracted_text: 'בבית המשפט העליון בע״מ 8206/14 פלונית נ׳ פלוני'.padEnd(600, "ט"),
    });
    expect(checkIdentity(s, expected).ok).toBe(true);
  });

  it("rejects a document that claims a docket its body does not contain", () => {
    const s = src({
      title: 'בע"מ 8206/14 פלונית נ\' פלוני',
      extracted_text: "פסק דין אחר לגמרי בעניין 1111/11".padEnd(600, "ט"),
    });
    const r = checkIdentity(s, expected);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("does not contain");
  });

  it("never accepts search metadata alone as identity proof", () => {
    const s = src({
      title: 'בע"מ 8206/14 — לפי תוצאת חיפוש',
      url: "https://example.com/8206-14",
      extracted_text: "עמוד תוצאות ללא גוף המסמך".padEnd(600, "ט"),
    });
    expect(checkIdentity(s, expected).ok).toBe(false);
  });

  it("rejects a statute body missing the claimed section", () => {
    const s = src({
      title: "חוק יחסי ממון בין בני זוג",
      extracted_text: "חוק יחסי ממון בין בני זוג\nסעיף 3. הסדר ממון".padEnd(600, "ט"),
    });
    expect(checkIdentity(s, expected).ok).toBe(false);
  });

  it("passes a statute body carrying the claimed section", () => {
    const s = src({
      title: "חוק יחסי ממון בין בני זוג",
      extracted_text: "חוק יחסי ממון בין בני זוג\n5. עם פקיעת הנישואין זכאי כל אחד מבני הזוג למחצית".padEnd(600, "ט"),
    });
    expect(checkIdentity(s, expected).ok).toBe(true);
  });

  it("does not reject a source that claims none of the run's obligations", () => {
    const s = src({ title: "מאמר על איזון משאבים", extracted_text: "טקסט אקדמי".padEnd(600, "ט") });
    expect(checkIdentity(s, expected).ok).toBe(true);
  });
});
