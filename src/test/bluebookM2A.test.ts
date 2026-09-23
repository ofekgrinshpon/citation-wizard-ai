import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderForeignCitation, detectForeignSource, stripMarkers } from "@/data/bluebook";
import { applyRepeatCitationRules } from "@/lib/footnoteRepeatRules";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";

const plain = (s: string) => stripMarkers(s);
const det = (s: string) => {
  const r = renderForeignCitation(s);
  return r && r.missing.length === 0 ? r : null;
};

describe("M2A — active Bluebook edition", () => {
  it("citation-chat foreign instructions reference Bluebook 22, never 21", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/citation-chat/index.ts"), "utf8");
    expect(src).not.toMatch(/(?:Bluebook|בלובוק)[^\n]{0,20}(?:מהדורה|edition|ed\.)\s*21/i);
    expect(src).not.toMatch(/Bluebook\s*21\b/);
    expect(src).toMatch(/(?:Bluebook|בלובוק)[^\n]{0,20}מהדורה 22/);
  });
});

describe("M2A — U.S. database-only cases", () => {
  it("DB1 complete Westlaw case", () => {
    const s = "Smith v. Jones, No. 18-cv-1234, 2019 WL 1234567, at *5 (S.D.N.Y. Mar. 22, 2019)";
    const d = detectForeignSource(s)!;
    expect(d.kind).toBe("case");
    expect(d.jurisdiction).toBe("US");
    expect(d.confidence).toBe("deterministic");
    const f = d.fields as Record<string, string | undefined>;
    expect(f.databaseIdentifier).toBe("2019 WL 1234567");
    expect(f.docket).toBe("18-cv-1234");
    expect(f.starPinpoint).toBe("5");
    expect(f.court).toBe("S.D.N.Y.");
    expect(f.decisionDate).toBe("Mar. 22, 2019");
    expect(f.reporter).toBeUndefined();
    expect(f.volume).toBeUndefined();
    expect(f.firstPage).toBeUndefined();
    expect(f.pinpoint).toBeUndefined();
    expect(plain(det(s)!.citation)).toBe(
      "Smith v. Jones, No. 18-cv-1234, 2019 WL 1234567, at *5 (S.D.N.Y. Mar. 22, 2019).",
    );
  });
  it("DB2 U.S. Dist. LEXIS", () => {
    const r = det("Doe v. Acme Corp., No. 1:17-cv-02011, 2018 U.S. Dist. LEXIS 44321, at *3 (D.D.C. March 16, 2018)")!;
    expect(plain(r.citation)).toBe(
      "Doe v. Acme Corp., No. 1:17-cv-02011, 2018 U.S. Dist. LEXIS 44321, at *3 (D.D.C. Mar. 16, 2018).",
    );
  });
  it("DB3 U.S. App. LEXIS", () => {
    const r = det("Roe v. Wade Enters., No. 20-5510, 2021 U.S. App. LEXIS 9876 (9th Cir. Apr. 5, 2021)")!;
    expect(plain(r.citation)).toBe(
      "Roe v. Wade Enters., No. 20-5510, 2021 U.S. App. LEXIS 9876 (9th Cir. Apr. 5, 2021).",
    );
  });
  it("DB4 incomplete database case declines — nothing fabricated", () => {
    expect(det("Smith v. Jones, 2019 WL 1234567")).toBeNull();
    expect(det("Smith v. Jones, 2019 WL 1234567 (S.D.N.Y. 2019)")).toBeNull();
    expect(det("Smith v. Jones, 2019 WL 1234567, at *5 (S.D.N.Y. Mar. 22, 2019)")).toBeNull();
    // year disagreement → decline
    expect(det("Smith v. Jones, No. 18-1, 2019 WL 1234567 (S.D.N.Y. Mar. 22, 2018)")).toBeNull();
  });
});

describe("M2A — traditional UK Law Reports", () => {
  it("UK1 Donoghue v Stevenson", () => {
    const s = "Donoghue v Stevenson [1932] AC 562 (HL)";
    const d = detectForeignSource(s)!;
    expect(d.kind).toBe("case");
    expect(d.jurisdiction).toBe("UK");
    expect(plain(det(s)!.citation)).toBe("Donoghue v Stevenson [1932] AC 562 (HL).");
  });
  it("UK2 volumed WLR series with pinpoint", () => {
    const d = detectForeignSource("Caparo Industries plc v Dickman [1990] 2 AC 605, 617 (HL)");
    // AC must not carry an in-year volume → decline rather than guess
    expect(d?.confidence === "deterministic" && (d.fields as { reporter?: string }).reporter).toBeFalsy();
    const r = det("Ghaidan v Godin-Mendoza [2004] 2 WLR 113, 120 (HL)")!;
    expect(plain(r.citation)).toBe("Ghaidan v Godin-Mendoza [2004] 2 WLR 113, 120 (HL).");
    expect(plain(det("Carlill v Carbolic Smoke Ball Co [1893] QB 256 (CA)")!.citation)).toBe(
      "Carlill v Carbolic Smoke Ball Co [1893] QB 256 (CA).",
    );
  });
  it("UK3 neutral citation unchanged", () => {
    const r = det("R (Miller) v Prime Minister [2019] UKSC 41")!;
    expect(plain(r.citation)).toBe("R (Miller) v Prime Minister [2019] UKSC 41.");
  });
  it("UK4 weak [year] letters page is not a deterministic UK case", () => {
    expect(det("Annual Report [2019] AC 12")).toBeNull();
    expect(det("See generally [2019] Ch 3")).toBeNull();
  });
});

describe("M2A — books and chapters", () => {
  it("B1 complete book", () => {
    const d = detectForeignSource("Aharon Barak, Proportionality (2012)")!;
    expect(d.kind).toBe("book");
    expect(plain(det("Aharon Barak, Proportionality (2012)")!.citation)).toBe("Aharon Barak, Proportionality (2012).");
  });
  it("B2 edition + pinpoint stay separate", () => {
    const d = detectForeignSource("H.L.A. Hart, The Concept of Law 100 (2d ed. 1994)")!;
    expect(d.kind).toBe("book");
    expect(d.fields).toMatchObject({ authors: "H.L.A. Hart", bookTitle: "The Concept of Law", pinpoint: "100", edition: "2d", year: "1994" });
    expect(plain(det("H.L.A. Hart, The Concept of Law 100 (2d ed. 1994)")!.citation)).toBe(
      "H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).",
    );
  });
  it("B3 ambiguous book falls through", () => {
    expect(det("Hart, Concept of Law")).toBeNull();
    expect(det("The Concept of Law (1994)")).toBeNull();
    expect(det("H.L.A. Hart, The Concept of Law (revised by someone 1994)")).toBeNull();
  });
  it("C1 complete chapter", () => {
    const s = "Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210, 214 (1979)";
    const d = detectForeignSource(s)!;
    expect(d.kind).toBe("book_chapter");
    expect(plain(det(s)!.citation)).toBe(
      "Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210, 214 (1979).",
    );
  });
  it("C2 chapter with editors and pinpoint", () => {
    const d = detectForeignSource(
      "Jeremy Waldron, The Concept and the Rule of Law, in Oxford Essays in Jurisprudence 1, 5 (Leslie Green & Brian Leiter eds., 2013)",
    )!;
    expect(d.kind).toBe("book_chapter");
    expect(d.fields).toMatchObject({ firstPage: "1", pinpoint: "5", editors: "Leslie Green & Brian Leiter", year: "2013" });
  });
  it("C3 chapter is never a journal article or book", () => {
    const d = detectForeignSource("Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210 (1979)")!;
    expect(d.kind).toBe("book_chapter");
  });
});

describe("M2A — journals", () => {
  it("A1 known U.S. journal → US", () => {
    const d = detectForeignSource("Cass R. Sunstein, Incompletely Theorized Agreements, 108 Harvard Law Review 1733 (1995)")!;
    expect(d.kind).toBe("journal_article");
    expect(d.jurisdiction).toBe("US");
    expect(d.sourceType).toBe("foreign_journal_article");
  });
  it("A2 known UK journal → UK", () => {
    const d = detectForeignSource("Paul Craig, Formal and Substantive Conceptions of the Rule of Law, 1997 Pub. L. 467")
      ?? detectForeignSource("T.R.S. Allan, Legislative Supremacy, 117 Law Quarterly Review 563 (2001)")!;
    expect(d.jurisdiction).toBe("UK");
    const r = det("T.R.S. Allan, Legislative Supremacy, 117 Law Quarterly Review 563 (2001)")!;
    expect(plain(r.citation)).toBe("T.R.S. Allan, Legislative Supremacy, 117 L.Q. Rev. 563 (2001).");
  });
  it("A3 unknown journal gets no invented abbreviation", () => {
    const d = detectForeignSource("Jane Doe, A Title, 12 Journal of Obscure Things 1 (2020)");
    expect(d?.kind === "journal_article").toBe(false);
  });
  it("A4 Coase remains unchanged", () => {
    expect(plain(det("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)")!.citation)).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).",
    );
  });
});

describe("M2A — invariants", () => {
  it("repeat of a new M2A source uses Israeli Rule 37", () => {
    const full = det("Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210 (1979)")!.citation;
    const out = applyRepeatCitationRules([
      { id: 1, input: "Raz chapter", output: full },
      { id: 2, input: "חוק העונשין", output: 'חוק העונשין, התשל"ז-1977.' },
      { id: 3, input: "Raz chapter", output: full },
      { id: 4, input: "Raz chapter", output: full },
    ]);
    const texts = out.map((c) => c.output ?? "").join("\n");
    expect(texts).not.toMatch(/\bId\.|\bIbid\.|\bsupra\b|\binfra\b/i);
    expect(out[3].output).toMatch(/שם/);
  });
  it("rich copy of an M2A article survives render → HTML → plain", () => {
    const r = det("T.R.S. Allan, Legislative Supremacy, 117 Law Quarterly Review 563 (2001)")!;
    expect(r.citation).toContain("^^L.Q. Rev.^^");
    const html = citationToHtml(r.citation);
    expect(html).toContain("font-variant:small-caps");
    expect(html).not.toContain("^^");
    expect(citationToPlain(r.citation)).toBe("T.R.S. Allan, Legislative Supremacy, 117 L.Q. Rev. 563 (2001).");
  });
});
