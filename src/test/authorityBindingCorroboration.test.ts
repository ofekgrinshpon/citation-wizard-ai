/**
 * v2_acquisition_ledger_verified_authority_binding_v1
 *
 * Invariant under test: authority-level reuse may suppress a later candidate
 * ONLY when the previously bound body positively corroborated that authority.
 * Requested label != identity. Readable body != identity.
 *
 * Nothing here hard-codes a specific Israeli statute in runtime logic; the
 * fixtures below are generic Statute A / Statute B stand-ins.
 */
import { describe, expect, it } from "vitest";
import {
  corroborateAuthority,
  statuteCoreName,
} from "../../supabase/functions/legal-research-v2/tools/authorityCorroboration";
import {
  AcquisitionLedger,
  authorityKeyOf,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";

const STATUTE_A = 'חוק ההסדרה הכללית, התשל"ג-1973';
const STATUTE_B = 'חוק המרשם הארצי, תשכ"ה-1965';

const bodyA = `${STATUTE_A}\n` +
  "1. הוראות כלליות בדבר תחולת החוק על הצדדים.\n".repeat(5) +
  "8. הסדר האיזון ייעשה בעת פקיעת הקשר בין הצדדים.\n";
const bodyB = `${STATUTE_B}\n` + "1. הוראות בדבר ניהול המרשם הארצי ורישום פרטים.\n".repeat(6);

function idFieldsFor(statutes: string[], dockets: string[] = []) {
  return { dockets, statutes, sections: [] as string[] };
}

async function storedSource(store: EvidenceStore, url: string, title: string, text: string) {
  return await store.append({
    url,
    title,
    origin: "test",
    fetch_status: "ok",
    extracted_text: text,
    is_actual_document: true,
  });
}

describe("A. a wrong readable document cannot bind the requested authority", () => {
  it("withholds the binding when the body is a different statute", () => {
    const res = corroborateAuthority({
      expected: { statute: STATUTE_A },
      title: STATUTE_B,
      text: bodyB,
      identity_fields: idFieldsFor([STATUTE_B]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(false);
    expect(res.basis).toBe("statute_title_absent_from_body");
  });

  it("the ledger records the attempt but creates no binding", () => {
    const ledger = new AcquisitionLedger();
    const key = authorityKeyOf({ statute: STATUTE_A })!;
    ledger.note(key, {
      url: "https://example.org/wrong",
      outcome: "readable_unconfirmed_identity",
      reason: "statute_title_absent_from_body",
      at: new Date().toISOString(),
      identity_corroborated: false,
    }, "S6");
    expect(ledger.acquired(key)).toBe(false);
    expect(ledger.get(key)!.attempts).toHaveLength(1);
    expect(ledger.get(key)!.acquired_source_id).toBeUndefined();
  });
});

describe("B. an unverified attempt cannot suppress a later correct candidate", () => {
  it("leaves the authority unresolved so another candidate may be acquired", () => {
    const ledger = new AcquisitionLedger();
    const key = authorityKeyOf({ statute: STATUTE_A })!;
    ledger.note(key, {
      url: "https://example.org/wrong",
      outcome: "readable_unconfirmed_identity",
      reason: "statute_title_absent_from_body",
      at: new Date().toISOString(),
      identity_corroborated: false,
    }, "S6");
    // The authority-reuse short-circuit keys off acquired_source_id only.
    expect(ledger.get(key)?.acquired_source_id).toBeUndefined();
    expect(ledger.state(key)!.unresolved).toBe(true);

    // The later, correct candidate corroborates and may bind.
    const ok = corroborateAuthority({
      expected: { statute: STATUTE_A },
      title: STATUTE_A,
      text: bodyA,
      identity_fields: idFieldsFor([STATUTE_A]),
      is_actual_document: true,
    });
    expect(ok.corroborated).toBe(true);
    ledger.note(key, {
      url: "https://example.org/right",
      outcome: "acquired",
      reason: `body_identity_corroborated:${ok.basis}`,
      at: new Date().toISOString(),
      identity_corroborated: true,
    }, "S9");
    expect(ledger.get(key)!.acquired_source_id).toBe("S9");
  });
});

describe("C. a corroborated binding is still reusable", () => {
  it("binds and reports the authority as resolved", () => {
    const ledger = new AcquisitionLedger();
    const key = authorityKeyOf({ statute: STATUTE_A })!;
    ledger.note(key, {
      url: "https://example.org/right",
      outcome: "acquired",
      reason: "body_identity_corroborated:statute_title_present_in_body",
      at: new Date().toISOString(),
      identity_corroborated: true,
    }, "S2");
    expect(ledger.acquired(key)).toBe(true);
    expect(ledger.state(key)!.usable_body_source_id).toBe("S2");
    expect(ledger.advice(key)).toContain("S2");
  });
});

describe("D. URL-level dedupe is unchanged", () => {
  it("an already-fetched URL is still found in the evidence store", async () => {
    const store = new EvidenceStore();
    const src = await storedSource(store, "https://example.org/wrong", STATUTE_B, bodyB);
    expect(store.findByUrl("https://example.org/wrong")?.source_id).toBe(src.source_id);
    // and the ledger still remembers the attempted URL for this authority
    const ledger = new AcquisitionLedger();
    const key = authorityKeyOf({ statute: STATUTE_A })!;
    ledger.note(key, {
      url: "https://example.org/wrong",
      outcome: "readable_unconfirmed_identity",
      reason: "statute_title_absent_from_body",
      at: new Date().toISOString(),
      identity_corroborated: false,
    });
    expect(ledger.attemptOn(key, "https://example.org/wrong")).not.toBeNull();
  });
});

describe("E. case docket behaviour does not regress", () => {
  it("corroborates when the docket is present in the body", () => {
    const res = corroborateAuthority({
      expected: { docket: 'בג"ץ 1234/20' },
      title: 'בג"ץ 1234/20 פלוני נ\' פלונית',
      text: 'בג"ץ 1234/20 — פסק דין. ' + "נימוקי בית המשפט. ".repeat(20),
      identity_fields: idFieldsFor([], ["1234/20"]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(true);
    expect(res.basis).toBe("docket_present_in_body");
  });

  it("rejects when the docket is absent", () => {
    const res = corroborateAuthority({
      expected: { docket: 'בג"ץ 1234/20' },
      title: "מסמך אחר",
      text: "טקסט שאינו מכיל את מספר התיק כלל.",
      identity_fields: idFieldsFor([], ["9999/01"]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(false);
    expect(res.basis).toBe("docket_absent_from_body");
  });
});

describe("F. statutes no longer treat a missing docket as vacuous success", () => {
  it("a readable non-matching body is not acquired", () => {
    const res = corroborateAuthority({
      expected: { statute: STATUTE_A },
      title: "עמוד תוצאות חיפוש",
      text: bodyB,
      identity_fields: idFieldsFor([]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(false);
  });

  it("a requested section must also be locatable", () => {
    const res = corroborateAuthority({
      expected: { statute: STATUTE_A, section: "25" },
      title: STATUTE_A,
      text: bodyA,
      identity_fields: idFieldsFor([STATUTE_A]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(false);
    expect(res.basis).toBe("statute_section_absent_from_body");
  });

  it("tolerates year-suffix and gershayim variance in the requested label", () => {
    expect(statuteCoreName('חוק ההסדרה הכללית, התשל"ג-1973')).toBe(
      statuteCoreName("חוק ההסדרה הכללית, תשל״ג-1973"),
    );
    const res = corroborateAuthority({
      expected: { statute: "חוק ההסדרה הכללית, תשל״ג-1973" },
      title: STATUTE_A,
      text: bodyA,
      identity_fields: idFieldsFor([STATUTE_A]),
      is_actual_document: true,
    });
    expect(res.corroborated).toBe(true);
  });
});

describe("G/H. scope guards", () => {
  it("an unreadable body never binds", () => {
    const res = corroborateAuthority({
      expected: { statute: STATUTE_A },
      title: STATUTE_A,
      text: "",
      identity_fields: idFieldsFor([]),
      is_actual_document: false,
    });
    expect(res.corroborated).toBe(false);
    expect(res.basis).toBe("body_not_a_document");
  });

  it("no runtime statute names are hard-coded in the corroboration module", async () => {
    const src = await Deno_readFallback();
    expect(src).not.toMatch(/יחסי ממון|מרשם האוכלוסין/);
  });
});

async function Deno_readFallback(): Promise<string> {
  const fs = await import("node:fs/promises");
  return await fs.readFile(
    "supabase/functions/legal-research-v2/tools/authorityCorroboration.ts",
    "utf8",
  );
}
