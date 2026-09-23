import { it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { renderForeignCitation, detectForeignSource, stripMarkers } from "@/data/bluebook";

const RECORDS: [string, string][] = [
  ["DB", "Hernandez v. Office of the Comm'r of Baseball, No. 18-cv-9035, 2019 WL 2537938, at *4 (S.D.N.Y. June 20, 2019)"],
  ["DB", "Faulkner v. Beer, No. 05-cv-2285, 2006 WL 2988054, at *2 (S.D.N.Y. Oct. 18, 2006)"],
  ["DB", "United States v. Johnson, No. 18-50175, 2019 U.S. App. LEXIS 23640, at *3 (9th Cir. Aug. 7, 2019)"],
  ["DB", "Ali v. City of New York, No. 11-cv-5469, 2012 U.S. Dist. LEXIS 124425, at *8 (S.D.N.Y. Aug. 30, 2012)"],
  ["DB", "Lopez v. Garland, No. 20-1234, 2022 WL 1112233 (2d Cir. Apr. 14, 2022)"],
  ["UK", "Donoghue v Stevenson [1932] AC 562 (HL)"],
  ["UK", "Carlill v Carbolic Smoke Ball Co [1893] QB 256 (CA)"],
  ["UK", "Anns v Merton London Borough Council [1978] AC 728 (HL)"],
  ["UK", "Pepper v Hart [1993] AC 593, 634 (HL)"],
  ["UK", "Ghaidan v Godin-Mendoza [2004] 2 WLR 113 (HL)"],
  ["UK-neutral", "R (Miller) v Prime Minister [2019] UKSC 41"],
  ["BOOK", "H.L.A. Hart, The Concept of Law 100 (2d ed. 1994)"],
  ["BOOK", "Ronald Dworkin, Law's Empire 45 (1986)"],
  ["BOOK", "Aharon Barak, Proportionality: Constitutional Rights and Their Limitations 131 (Doron Kalir trans., 2012)"],
  ["BOOK", "John Rawls, A Theory of Justice (rev. ed. 1999)"],
  ["CHAPTER", "Joseph Raz, The Rule of Law and Its Virtue, in The Authority of Law 210, 214 (1979)"],
  ["CHAPTER", "Jeremy Waldron, The Concept and the Rule of Law, in Oxford Essays in Jurisprudence 1, 5 (Leslie Green & Brian Leiter eds., 2013)"],
  ["CHAPTER", "Lon L. Fuller, Positivism and Fidelity to Law, in Philosophy of Law 15 (Joel Feinberg ed., 5th ed. 1995)"],
  ["CHAPTER", "Frederick Schauer, Precedent, in The Routledge Companion to Philosophy of Law 123 (Andrei Marmor ed., 2012)"],
  ["ARTICLE", "Cass R. Sunstein, Incompletely Theorized Agreements, 108 Harvard Law Review 1733 (1995)"],
  ["ARTICLE", "Daniel J. Solove, A Taxonomy of Privacy, 154 U. Pa. L. Rev. 477, 490 (2006)"],
  ["ARTICLE", "Richard H. Fallon, Jr., The Core of an Uneasy Case for Judicial Review, 121 Harv. L. Rev. 1693 (2008)"],
  ["ARTICLE", "Mark Tushnet, Alternative Forms of Judicial Review, 101 Michigan Law Review 2781 (2003)"],
  ["ARTICLE", "Aileen Kavanagh, The Idea of a Living Constitution, 16 Canadian Journal of Law and Jurisprudence 55 (2003)"],
  ["ARTICLE", "T.R.S. Allan, Legislative Supremacy and the Rule of Law, 44 Cambridge Law Journal 111 (1985)"],
  ["NEG", "Smith v. Jones, 2019 WL 1234567"],
  ["NEG", "Hart, The Concept of Law"],
  ["NEG", "Annual Report [2019] AC 12"],
];

it("M2A live acceptance", () => {
  const lines: string[] = [];
  RECORDS.forEach(([cat, input], i) => {
    const d = detectForeignSource(input);
    const r = renderForeignCitation(input);
    const ok = !!r && r.missing.length === 0;
    lines.push(
      `#${i + 1} [${cat}]`,
      `  input:        ${input}`,
      `  family:       ${d?.kind ?? "-"}`,
      `  jurisdiction: ${d?.jurisdiction ?? "-"}`,
      `  confidence:   ${d?.confidence ?? "none"}`,
      `  fields:       ${d ? JSON.stringify(d.fields) : "-"}`,
      `  deterministic:${ok ? " yes" : " no"}`,
      `  final:        ${ok ? stripMarkers(r!.citation) : "(existing engine)"}`,
      `  marked:       ${ok ? r!.citation : "-"}`,
      `  warnings:     ${r?.warnings.join(" | ") || "-"}`,
      `  fallback:     ${ok ? "-" : !d ? "no deterministic detection" : d.confidence !== "deterministic" ? "shape-only signal" : `missing: ${r?.missing.join(", ")}`}`,
      "",
    );
  });
  const dir = "reports/final-acceptance/bluebook22-foreign-citation-engine-m2a";
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/ACCEPTANCE_RECORDS.txt`, lines.join("\n"));
  console.log(lines.join("\n"));
});
