import { describe, it, expect } from "vitest";
import {
  renderForeignCitation,
  renderBook,
  renderBookChapter,
  renderInternet,
  renderUkStatute,
  stripMarkers,
} from "@/data/bluebook";

const plain = (s: string) => stripMarkers(s);

describe("Bluebook 22 — deterministic golden rendering (M1)", () => {
  it("US Supreme Court case (reporter implies court)", () => {
    const r = renderForeignCitation("Brown v. Board of Education, 347 U.S. 483 (1954)")!;
    expect(plain(r.citation)).toBe("Brown v. Board of Education, 347 U.S. 483 (1954).");
  });

  it("US Supreme Court case with pinpoint", () => {
    const r = renderForeignCitation("Brown v. Board of Education, 347 U.S. 483, 490 (1954)")!;
    expect(plain(r.citation)).toBe("Brown v. Board of Education, 347 U.S. 483, 490 (1954).");
  });

  it("Court of Appeals case keeps the court in the parenthetical", () => {
    const r = renderForeignCitation("United States v. Carroll Towing Co., 159 F.2d 169 (2d Cir. 1947)")!;
    expect(plain(r.citation)).toBe(
      "United States v. Carroll Towing Co., 159 F.2d 169 (2d Cir. 1947).",
    );
  });

  it("District Court case", () => {
    const r = renderForeignCitation("Doe v. Roe, 100 F. Supp. 2d 1 (S.D.N.Y. 2000)")!;
    expect(plain(r.citation)).toBe("Doe v. Roe, 100 F. Supp. 2d 1 (S.D.N.Y. 2000).");
  });

  it("case name is italicised", () => {
    const r = renderForeignCitation("Brown v. Board of Education, 347 U.S. 483 (1954)")!;
    expect(r.citation.startsWith("##Brown v. Board of Education##")).toBe(true);
  });

  it("U.S. Constitution uses small caps", () => {
    const r = renderForeignCitation("U.S. CONST. amend. XIV, § 1")!;
    expect(plain(r.citation)).toBe("U.S. Const. amend. XIV, § 1.");
    expect(r.citation).toContain("^^U.S. Const.^^");
  });

  it("U.S.C. single section uses § and a range uses §§", () => {
    expect(plain(renderForeignCitation("42 U.S.C. § 1983 (2018)")!.citation)).toBe(
      "42 U.S.C. § 1983 (2018).",
    );
    const range = renderForeignCitation("Sherman Act, 15 U.S.C. §§ 1–7")!;
    expect(plain(range.citation)).toBe("Sherman Act, 15 U.S.C. §§ 1–7.");
  });

  it("law-review article with and without pinpoint", () => {
    const a = renderForeignCitation(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)",
    )!;
    expect(plain(a.citation)).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).",
    );
    const b = renderForeignCitation(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1, 15 (1960)",
    )!;
    expect(plain(b.citation)).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1, 15 (1960).",
    );
  });

  it("journal name is abbreviated only when known", () => {
    const known = renderForeignCitation(
      "Guido Calabresi, Some Thoughts on Risk Distribution, 70 Yale L.J. 499 (1961)",
    )!;
    expect(plain(known.citation)).toContain("70 Yale L.J. 499");
  });

  it("book", () => {
    const r = renderBook({
      authors: "H.L.A. Hart",
      bookTitle: "The Concept of Law",
      edition: "2d",
      year: "1994",
      pinpoint: "100",
    });
    expect(plain(r.citation)).toBe("H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).");
  });

  it("book chapter stays distinct from an article", () => {
    const r = renderBookChapter({
      authors: "Joseph Raz",
      chapterTitle: "The Rule of Law and Its Virtue",
      bookTitle: "The Authority of Law",
      firstPage: "210",
      pinpoint: "214",
      year: "1979",
    });
    expect(plain(r.citation)).toBe(
      "Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210, 214 (1979).",
    );
  });

  it("UK neutral citation", () => {
    const r = renderForeignCitation("R (Miller) v Prime Minister [2019] UKSC 41")!;
    expect(plain(r.citation)).toBe("R (Miller) v Prime Minister [2019] UKSC 41.");
  });

  it("UK statute", () => {
    const r = renderUkStatute({ statuteName: "Human Rights Act 1998", year: "1998", chapter: "42" });
    expect(plain(r.citation)).toBe("Human Rights Act 1998, c. 42.");
  });

  it("internet source", () => {
    const r = renderInternet({
      title: "Court Reform Explained",
      site: "SCOTUSblog",
      date: "Mar. 22, 2019",
      url: "https://www.scotusblog.com/example",
    });
    expect(plain(r.citation)).toBe(
      "Court Reform Explained, SCOTUSblog (Mar. 22, 2019), https://www.scotusblog.com/example.",
    );
  });

  it("never fabricates a missing reporter — reports it as missing instead", () => {
    const r = renderForeignCitation("Smith v. Jones");
    expect(r).toBeNull();
  });
});
