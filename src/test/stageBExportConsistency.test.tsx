import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FormattedCitation } from "@/components/FormattedCitation";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { citationToOoxml, getPlainCitationText } from "@/lib/wordInsertion";
import { applyRepeatCitationRules, extractShortSourceLabel } from "@/lib/footnoteRepeatRules";
import { buildBibliographyCopy } from "@/lib/bibliographyCopy";
import { normalizeCourt } from "@/data/bluebook/tables";
import { renderForeignCitation } from "@/data/bluebook";

const ARTICLE = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";
const BOOK = "^^H.L.A. Hart, The Concept of Law^^ 100 (2d ed. 1994).";
const US_CASE = "##Brown v. Board of Education##, 347 U.S. 483, 490 (1954).";

describe("Word export — native styles, no marker leakage", () => {
  it("encodes small caps as a native run property, never as literal ^^", () => {
    const ooxml = citationToOoxml(ARTICLE);
    expect(ooxml).toContain("<w:smallCaps/>");
    expect(ooxml).not.toContain("^^");
    expect(ooxml).not.toContain("##");
    expect(ooxml).toContain("<w:i/>");
    // Every text segment survives.
    for (const piece of ["Ronald H. Coase, ", "The Problem of Social Cost", ", 3 ", "J.L. &amp; Econ.", " 1 (1960)."]) {
      expect(ooxml).toContain(piece);
    }
  });

  it("plain Word fallback contains no internal markers", () => {
    expect(getPlainCitationText(ARTICLE)).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).",
    );
    expect(getPlainCitationText(BOOK)).toBe("H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).");
  });

  it("escapes untrusted HTML-looking text inside Word runs", () => {
    const ooxml = citationToOoxml('##<img src=x onerror="a">## v. Roe, 100 F.3d 1 (2d Cir. 2000)');
    expect(ooxml).not.toContain("<img");
    expect(ooxml).toContain("&lt;img src=x");
  });
});

describe("repeat citations — Israeli 37.9 form, distinct from full-citation styling", () => {
  it("full citation keeps italic case name; repeat stays plain שם with no markers", () => {
    const out = applyRepeatCitationRules([
      { id: 1, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: US_CASE },
      { id: 2, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: US_CASE },
    ]);
    expect(out[0].output).toContain("##Brown v. Board of Education##");
    expect(out[1].output).toMatch(/^שם\./);
    expect(out[1].output).not.toMatch(/##|\^\^|\*\*/);
  });

  it("short-source label from a small-caps book citation never leaks ^^", () => {
    const label = extractShortSourceLabel(BOOK);
    expect(label).not.toContain("^^");
    expect(label).not.toContain("##");
    expect(label).toContain("H.L.A. Hart");
  });

  it("non-adjacent repeat of a small-caps source carries a clean label", () => {
    const out = applyRepeatCitationRules([
      { id: 1, input: "Hart, The Concept of Law, בעמ' 100", output: BOOK },
      { id: 2, input: "חוק העונשין", output: 'חוק העונשין, התשל"ז-1977.' },
      { id: 3, input: "Hart, The Concept of Law, בעמ' 100", output: BOOK },
    ]);
    expect(out[2].output).toContain('לעיל ה"ש 1');
    expect(out[2].output).not.toMatch(/##|\^\^|\*\*/);
  });
});

describe("bibliography copy — styles preserved in rich output, clean plain fallback", () => {
  const groups = [
    {
      label: "מקורות באנגלית",
      entries: [{ fullCitation: ARTICLE }, { fullCitation: BOOK }],
    },
  ];

  it("rich HTML keeps italic and small caps; plain text has no markers", () => {
    const { html, plain } = buildBibliographyCopy(groups);
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).toContain("font-variant:small-caps");
    expect(html).not.toMatch(/##|\^\^|\*\*/);
    expect(plain).toContain("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).");
    expect(plain).toContain("H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).");
    expect(plain).not.toMatch(/##|\^\^|\*\*/);
  });

  it("keeps the group label and every entry, and escapes untrusted text", () => {
    const { html, plain } = buildBibliographyCopy([
      { label: "מקורות באנגלית", entries: [{ fullCitation: '<b>not bold</b> ##x##, 1 ^^Yale L.J.^^ 1 (2000).' }] },
    ]);
    expect(html).toContain("מקורות באנגלית");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
    expect(plain).toContain("<b>not bold</b> x, 1 Yale L.J. 1 (2000).");
  });
});

describe("court ordinal presentation (bounded formatting-path fixture)", () => {
  it("normalizes 2nd/3rd circuit ordinals to 2d/3d in the formatting path", () => {
    expect(normalizeCourt("2nd Circuit")).toBe("2d Cir.");
    expect(normalizeCourt("3rd Circuit")).toBe("3d Cir.");
    expect(normalizeCourt("2nd Cir.")).toBe("2d Cir.");
    expect(normalizeCourt("3d Cir.")).toBe("3d Cir.");
  });

  it("leaves other ordinals and unknown courts untouched", () => {
    expect(normalizeCourt("9th Circuit")).toBe("9th Cir.");
    expect(normalizeCourt("7th Cir.")).toBe("7th Cir.");
    expect(normalizeCourt("Some Unknown Court")).toBe("Some Unknown Court");
  });

  it("end-to-end: a case citing the Second Circuit renders 2d Cir.", () => {
    const r = renderForeignCitation("Example v. Sample, 100 F.3d 200 (2nd Cir. 1996)")!;
    expect(r.citation).toContain("(2d Cir. 1996)");
    expect(r.citation).not.toContain("2nd");
  });
});

describe("context-appropriate styling (R2.1 fixtures, Israeli profile)", () => {
  it("full foreign citation keeps the case name roman (R2.1(a), full-citation context)", () => {
    const r = renderForeignCitation("Brown v. Board of Education, 347 U.S. 483 (1954)")!;
    expect(r.citation.startsWith("Brown v. Board of Education, 347 U.S. 483")).toBe(true);
  });

  it("the same citation keeps every segment across display, rich copy and Word", () => {
    const r = renderForeignCitation(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1, 15 (1960)",
    )!;
    const text = r.citation;
    // Display
    const { container } = render(
      <TooltipProvider>
        <FormattedCitation text={text} />
      </TooltipProvider>,
    );
    expect(container.textContent).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1, 15 (1960).",
    );
    expect(container.querySelector("em")?.textContent).toBe("The Problem of Social Cost");
    // Rich copy
    expect(citationToHtml(text)).toContain("font-variant:small-caps");
    expect(citationToPlain(text)).toBe(container.textContent);
    // Word
    const ooxml = citationToOoxml(text);
    expect(ooxml).toContain("<w:smallCaps/>");
    expect(ooxml).not.toMatch(/##|\^\^/);
  });

  it("warning/unsupported content is never converted into a valid-looking citation", () => {
    const r = renderForeignCitation("Example v. Sample, 100 F.3d 200 (2d Cir. 1996) (Taylor, J., dissenting)")!;
    expect(r.warnings.length).toBeGreaterThan(0);
    // The unsupported suffix survives verbatim through every output channel.
    expect(citationToPlain(r.citation)).toContain("(Taylor, J., dissenting)");
    expect(citationToOoxml(r.citation)).toContain("dissenting");
    expect(citationToHtml(r.citation)).toContain("dissenting");
  });
});
