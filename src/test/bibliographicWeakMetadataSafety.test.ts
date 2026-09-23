/**
 * pdf_author_requires_stronger_basis_v1 + machine-label title fail-safe.
 *
 * Acceptance #4 shipped two confidently false authors into user footnotes, in
 * both cases with field_basis.authors = "pdf_metadata", plus one machine label
 * ("fs3d rep bv 449") rendered as a source title. These are the regressions.
 */
import { describe, expect, it } from "vitest";

import {
  formatAcademicCitation,
  isGarbageTitleValue,
  looksLikeMachineDocumentLabel,
  mergeBibliographic,
  parseHtmlBibliographic,
  parsePdfInfoMetadata,
  sanitizeBibliographic,
} from "../../supabase/functions/legal-research-v2/shared/bibliographic";
import { bibliographicFromSearch } from "../../supabase/functions/legal-research-v2/shared/bibliographic";

const repoHtml = (authors: string[], title: string) =>
  [
    `<meta name="citation_title" content="${title}">`,
    ...authors.map((a) => `<meta name="citation_author" content="${a}">`),
    `<meta name="citation_journal_title" content="משפטים">`,
  ].join("\n");

describe("B1 — an author known only from embedded PDF metadata is never rendered", () => {
  it("keeps the title and drops the PDF-only author", () => {
    const merged = mergeBibliographic(
      bibliographicFromSearch({ title: "התביעה הנגזרת בישראל — סיכום ביניים ומבט לעתיד" }),
      parsePdfInfoMetadata({ Author: "Ido Baum" }),
    )!;
    expect(merged.title).toContain("התביעה הנגזרת");
    expect(merged.authors).toBeUndefined();
    expect(merged.dropped_fields).toContain("authors:pdf_metadata_not_sole_basis");
  });
});

describe("B2 — a repository author is a strong enough basis", () => {
  it("renders authors coming from citation_author tags", () => {
    const meta = parseHtmlBibliographic(repoHtml(["אסף חמדני", "קובי קסטיאל"], "מאמר"))!;
    expect(meta.authors).toEqual(["אסף חמדני", "קובי קסטיאל"]);
    expect(sanitizeBibliographic(meta, {})!.authors).toEqual(["אסף חמדני", "קובי קסטיאל"]);
  });
});

describe("B3 — PDF metadata agreeing with a stronger source changes nothing", () => {
  it("keeps the strong author and its provenance", () => {
    const merged = mergeBibliographic(
      parseHtmlBibliographic(repoHtml(["אסף חמדני"], "מאמר")),
      parsePdfInfoMetadata({ Author: "אסף חמדני" }),
    )!;
    expect(merged.authors).toEqual(["אסף חמדני"]);
    expect(merged.field_basis?.authors).toBe("repository_page");
  });
});

describe("B4 — a conflicting PDF author never leaks past a stronger one", () => {
  it("renders only the stronger author", () => {
    const merged = mergeBibliographic(
      parseHtmlBibliographic(repoHtml(["שרון חנס"], "מאמר")),
      parsePdfInfoMetadata({ Author: "Ido Baum" }),
    )!;
    expect(merged.authors).toEqual(["שרון חנס"]);
    expect(JSON.stringify(merged)).not.toContain("Ido Baum");
  });
});

describe("B5 — several PDF-only authors are all omitted", () => {
  it("drops the whole author field rather than rendering a guess", () => {
    const merged = mergeBibliographic(
      bibliographicFromSearch({ title: "מאמר אקדמי כלשהו", published_date: "2021-01-01" }),
      parsePdfInfoMetadata({ Author: "Ido Baum; נופר אזולאי; Jane Roe" }),
    )!;
    expect(merged.authors).toBeUndefined();
  });
});

describe("B6 — Acceptance #4 Weisman/Hamdani/Kastiel regression", () => {
  it("never renders Ido Baum in the citation text", () => {
    const meta = sanitizeBibliographic(
      mergeBibliographic(
        bibliographicFromSearch({
          title: "התביעה הנגזרת בישראל — סיכום ביניים ומבט לעתיד",
          published_date: "2019",
        }),
        parsePdfInfoMetadata({ Author: "Ido Baum", CreationDate: "D:20190101" }),
      ),
      { url: "https://example.ac.il/weisman-hamdani-kastiel.pdf" },
    );
    const text = formatAcademicCitation(meta, "התביעה הנגזרת בישראל") ?? "";
    expect(text).not.toContain("Ido Baum");
    expect(text).toContain("התביעה הנגזרת");
  });
});

describe("B7 — Acceptance #4 Levi article regression", () => {
  it("never renders נופר אזולאי solely from PDF metadata", () => {
    const meta = sanitizeBibliographic(
      mergeBibliographic(
        bibliographicFromSearch({ title: "עניין אישי ומעמדם של בעלי השליטה בדיני חברות" }),
        parsePdfInfoMetadata({ Author: "נופר אזולאי" }),
      ),
      { url: "https://example.ac.il/levi.pdf" },
    )!;
    expect(meta.authors).toBeUndefined();
    expect(formatAcademicCitation(meta, "עניין אישי") ?? "").not.toContain("נופר אזולאי");
  });

  it("drops a PDF-only author even when sanitize is called without a merge", () => {
    const meta = sanitizeBibliographic(
      parsePdfInfoMetadata({ Title: "עניין אישי ומעמדם של בעלי השליטה", Author: "נופר אזולאי" }),
      { url: "https://example.ac.il/levi.pdf" },
    )!;
    expect(meta.authors).toBeUndefined();
    expect(meta.title).toContain("עניין אישי");
  });
});

describe("B8 — machine document labels are rejected as titles", () => {
  it("rejects the Acceptance #4 L7 label", () => {
    expect(looksLikeMachineDocumentLabel("fs3d rep bv 449")).toBe(true);
    expect(isGarbageTitleValue("fs3d rep bv 449")).toBe(true);
  });

  it("rejects similar internal labels", () => {
    expect(isGarbageTitleValue("ab12 draft v3")).toBe(true);
    expect(isGarbageTitleValue("qx7 rev 0012")).toBe(true);
  });
});

describe("B9 — legitimate short titles survive", () => {
  const legit = [
    "Brown v. Board of Education",
    "Roe v. Wade",
    "Chevron",
    "Law and Finance",
    "The Corporate Governance Role of Controlling Shareholders",
    "בעיית הנציג בחברות ציבוריות",
    'בג"ץ 5658/23',
    "law and finance",
    "corporate governance in israel",
  ];
  it("keeps every ordinary legal or academic title", () => {
    for (const t of legit) {
      expect(looksLikeMachineDocumentLabel(t), t).toBe(false);
      expect(isGarbageTitleValue(t), t).toBe(false);
    }
  });
});

describe("year behaviour is deliberately unchanged", () => {
  it("lets a stronger year win and leaves a PDF-only year as-is", () => {
    const strong = mergeBibliographic(
      parseHtmlBibliographic(
        '<meta name="citation_title" content="מאמר"><meta name="citation_date" content="2018">',
      ),
      parsePdfInfoMetadata({ CreationDate: "D:20240101" }),
    )!;
    expect(strong.year).toBe("2018");
    const pdfOnly = mergeBibliographic(
      bibliographicFromSearch({ title: "מאמר אחר" }),
      parsePdfInfoMetadata({ CreationDate: "D:20240101" }),
    )!;
    expect(pdfOnly.year).toBe("2024");
  });
});
