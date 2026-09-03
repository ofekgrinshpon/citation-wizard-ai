// local_retrieval_precision_tuning_v1 — Hebrew lexical query construction.
import { describe, expect, it } from "vitest";
import {
  buildHebrewFtsQuery,
  hebrewVariants,
  legacyRequiredTerms,
  stripHebrewPrefix,
} from "../../supabase/functions/legal-research-v1/stages/hebrewFts.ts";

describe("stripHebrewPrefix", () => {
  it("strips the definite article", () => {
    expect(stripHebrewPrefix("המידתיות")).toBe("מידתיות");
    expect(stripHebrewPrefix("ההגבלה")).toBe("הגבלה");
  });
  it("never mutilates protected lemmas", () => {
    expect(stripHebrewPrefix("מידתיות")).toBe("מידתיות");
    expect(stripHebrewPrefix("ביקורת")).toBe("ביקורת");
    expect(stripHebrewPrefix("הליך")).toBe("הליך");
  });
  it("leaves latin tokens alone", () => {
    expect(stripHebrewPrefix("proportionality")).toBe("proportionality");
  });
});

describe("hebrewVariants", () => {
  it("covers the common clitic prefixes", () => {
    const v = hebrewVariants("מידתיות");
    for (const t of ["מידתיות", "המידתיות", "למידתיות", "במידתיות", "ומידתיות"]) {
      expect(v).toContain(t);
    }
  });
});

describe("buildHebrewFtsQuery", () => {
  it("selects salient legal phrases instead of the longest words", () => {
    const q = "מבחן המידתיות פסקת ההגבלה";
    const r = buildHebrewFtsQuery(q, ["פסקת ההגבלה", "מבחן המידתיות"]);
    expect(r.term_selection.required_terms_new).toEqual(
      expect.arrayContaining(["פסקת ההגבלה", "מבחן המידתיות"]),
    );
    expect(legacyRequiredTerms(q)).toEqual(["המידתיות", "ההגבלה"]);
    expect(r.term_selection.required_terms_new).not.toEqual(legacyRequiredTerms(q));
  });

  it("expands prefix variants for doctrine terms", () => {
    const r = buildHebrewFtsQuery("עקרון המידתיות ביקורת חוקתית", []);
    expect(r.tsq_primary).toContain("המידתיות");
    expect(r.tsq_primary).toContain("למידתיות");
    expect(r.normalization.added_variants.length).toBeGreaterThan(0);
  });

  it("keeps phrases adjacency-sensitive", () => {
    const r = buildHebrewFtsQuery("פסקת ההגבלה מידתיות", ["פסקת ההגבלה"]);
    expect(r.tsq_primary).toContain("<->");
    expect(r.normalization.preserved_phrases).toContain("פסקת ההגבלה");
  });

  it("never promotes generic court words to required terms", () => {
    const r = buildHebrewFtsQuery("בית המשפט העליון פסק דין מידתיות", []);
    expect(r.term_selection.required_terms_new).not.toContain("משפט");
    expect(r.term_selection.required_terms_new).not.toContain("דין");
  });

  it("produces a recall fallback distinct from the precise query", () => {
    const r = buildHebrewFtsQuery("דוקטרינת ההסתמכות הבטחה מנהלית", ["הבטחה מנהלית"]);
    expect(r.tsq_primary.length).toBeGreaterThan(0);
    expect(r.tsq_fallback.length).toBeGreaterThanOrEqual(r.tsq_primary.length);
  });

  it("degrades safely on empty input", () => {
    const r = buildHebrewFtsQuery("", []);
    expect(r.tsq_primary).toBe("");
    expect(r.tsq_fallback).toBe("");
  });
});
