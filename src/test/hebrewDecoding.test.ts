/**
 * S1/S2 — charset-aware Hebrew decoding + unreadable-encoding safety gate.
 * Deterministic, no network.
 */
import { describe, expect, it } from "vitest";
import {
  DECODE_QUALITY,
  decodeResponseText,
  isUnreadableEncoding,
  replacementRatio,
} from "../../supabase/functions/legal-research-v2/shared/textDecoding";
import {
  checkIsActualDocument,
  extractByContentType,
} from "../../supabase/functions/legal-research-v2/tools/fetch";
import { corroborateAuthority } from "../../supabase/functions/legal-research-v2/tools/authorityCorroboration";

/** Encode a string as Windows-1255 (Hebrew block + ASCII + a few punctuation marks). */
function cp1255(input: string): Uint8Array {
  const out: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp >= 0x05d0 && cp <= 0x05ea) out.push(cp - 0x05d0 + 0xe0);
    else if (cp === 0x05b0) out.push(0xc0);
    else if (cp === 0x201c) out.push(0x93);
    else if (cp === 0x201d) out.push(0x94);
    else out.push(0x3f); // '?'
  }
  return new Uint8Array(out);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** A realistic Hebrew legal-text fixture (judgment prose, not isolated words). */
const HEB_JUDGMENT = [
  'בבית המשפט העליון בשבתו כבית משפט גבוה לצדק',
  'בג"ץ 4602/13',
  'לפני: כבוד הנשיאה מ. נאור',
  'השאלה המשפטית שבפנינו נוגעת לתחולתה של חזקת השיתוף בנכסים שנרשמו על שם אחד מבני הזוג בלבד,',
  'ולשאלה אם התנהגות של בן זוג במהלך חיי הנישואין עשויה לשלול את כוונת השיתוף הספציפי בדירת המגורים.',
  'לדעת הרוב, אין בהתנהגות כשלעצמה כדי לשלול זכות קניינית שהוקנתה מכוח הדין, ואולם יש בה כדי להשליך',
  'על היקף התרומה והציפייה הסבירה של הצדדים. אנו קובעים אפוא כי יש לבחון כל מקרה לגופו, על יסוד מכלול',
  'הנסיבות, ובכלל זה אורך התקופה, השקעות משותפות, וניהול משק בית משותף. סוף דבר, העתירה מתקבלת בחלקה.',
].join("\n").repeat(3);

const ENGLISH_DOC = (
  "In the Court of Appeal. The appellant submits that the trial judge erred in law. " +
  "The respondent contends otherwise. We consider the statutory framework and the authorities. " +
  "For these reasons the appeal is dismissed with costs. "
).repeat(12);

describe("decodeResponseText", () => {
  it("decodes Windows-1255 Hebrew bytes correctly when no charset is declared", () => {
    const d = decodeResponseText(cp1255(HEB_JUDGMENT), "text/plain");
    expect(d.charset_used).toBe("windows-1255");
    expect(d.fallback_applied).toBe(true);
    expect(d.text).toContain("חזקת השיתוף");
    expect(d.text).toContain("4602/13");
    expect(replacementRatio(d.text)).toBeLessThan(0.01);
  });

  it("leaves UTF-8 Hebrew unchanged", () => {
    const d = decodeResponseText(utf8(HEB_JUDGMENT), "text/plain; charset=utf-8");
    expect(d.charset_used).toMatch(/utf-8/i);
    expect(d.fallback_applied).toBe(false);
    expect(d.text).toBe(HEB_JUDGMENT);
  });

  it("leaves UTF-8 English unchanged", () => {
    const d = decodeResponseText(utf8(ENGLISH_DOC), "text/plain");
    expect(d.text).toBe(ENGLISH_DOC);
    expect(d.fallback_applied).toBe(false);
  });

  it("honors an explicit windows-1255 charset", () => {
    const d = decodeResponseText(cp1255(HEB_JUDGMENT), 'text/html; charset="windows-1255"');
    expect(d.charset_declared).toBe("windows-1255");
    expect(d.charset_used).toBe("windows-1255");
    expect(d.text).toContain("כוונת השיתוף");
  });

  it("honors an explicit utf-8 charset", () => {
    const d = decodeResponseText(utf8(HEB_JUDGMENT), "text/plain; charset=UTF-8");
    expect(d.charset_declared).toBe("utf-8");
    expect(d.text).toBe(HEB_JUDGMENT);
  });

  it("falls back to windows-1255 when UTF-8 decoding is corrupted", () => {
    const bytes = cp1255(HEB_JUDGMENT);
    const naive = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    expect(replacementRatio(naive)).toBeGreaterThan(DECODE_QUALITY.MAX_REPLACEMENT_RATIO);
    const d = decodeResponseText(bytes, "application/octet-stream");
    expect(d.replacement_ratio).toBeLessThan(d.replacement_ratio_utf8);
    expect(d.text).toContain("בית המשפט העליון");
  });
});

describe("extractByContentType", () => {
  it("decodes windows-1255 HTML before stripping tags", async () => {
    const html = `<html><body><p>${HEB_JUDGMENT}</p></body></html>`;
    const out = await extractByContentType(
      "https://example.org/doc",
      "text/html",
      cp1255(html),
    );
    expect(out.text).toContain("חזקת השיתוף");
    expect(out.text).not.toContain("<p>");
    expect(out.decode?.charset_used).toBe("windows-1255");
  });

  it("does not change PDF extraction behaviour", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00]);
    const out = await extractByContentType("https://example.org/a.pdf", "application/pdf", bytes);
    expect(out.decode).toBeUndefined();
    expect(out.text).toBe("");
    expect(out.error ?? "").toMatch(/pdf_extract_failed/);
  });

  it("does not change DOCX extraction behaviour", async () => {
    const bytes = utf8("not a real docx");
    const out = await extractByContentType(
      "https://example.org/a.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    );
    expect(out.decode).toBeUndefined();
    expect(out.error ?? "").toMatch(/docx_extract_failed/);
  });
});

describe("unreadable-encoding gate", () => {
  const mojibake = new TextDecoder("utf-8", { fatal: false }).decode(cp1255(HEB_JUDGMENT));

  it("classifies a body with a high U+FFFD ratio as unreadable_encoding", () => {
    expect(isUnreadableEncoding(mojibake)).toBe(true);
    const check = checkIsActualDocument(mojibake);
    expect(check.is_actual_document).toBe(false);
    expect(check.reason).toBe("unreadable_encoding");
  });

  it("accepts clean Hebrew and clean English bodies", () => {
    expect(checkIsActualDocument(HEB_JUDGMENT).is_actual_document).toBe(true);
    expect(isUnreadableEncoding(ENGLISH_DOC)).toBe(false);
    expect(checkIsActualDocument(ENGLISH_DOC).is_actual_document).toBe(true);
  });

  it("refuses to bind an authority from a corrupted body that still shows the docket", () => {
    expect(mojibake).toContain("4602/13");
    const res = corroborateAuthority({
      expected: { docket: "4602/13" },
      title: "בג\"ץ 4602/13",
      text: mojibake,
      identity_fields: { dockets: ["4602/13"], statutes: [], sections: [] },
      is_actual_document: checkIsActualDocument(mojibake).is_actual_document,
    });
    expect(res.corroborated).toBe(false);
    expect(res.basis).toBe("body_not_a_document");
  });

  it("binds normally from a clean UTF-8 body with the same docket", () => {
    const res = corroborateAuthority({
      expected: { docket: "4602/13" },
      title: "בג\"ץ 4602/13",
      text: HEB_JUDGMENT,
      identity_fields: { dockets: ["4602/13"], statutes: [], sections: [] },
      is_actual_document: checkIsActualDocument(HEB_JUDGMENT).is_actual_document,
    });
    expect(res.corroborated).toBe(true);
    expect(res.basis).toBe("docket_present_in_body");
  });
});
