import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FormattedCitation } from "@/components/FormattedCitation";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";

const sample = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";

describe("small caps + rich copy (M1)", () => {
  it("renders small caps in the preview and never leaks the marker", () => {
    const { container } = render(
      <TooltipProvider>
        <FormattedCitation text={sample} />
      </TooltipProvider>,
    );
    expect(container.textContent).not.toContain("^^");
    expect(container.textContent).not.toContain("##");
    expect(container.innerHTML).toContain("small-caps");
    expect(container.querySelector("em")?.textContent).toBe("The Problem of Social Cost");
  });

  it("produces rich HTML with real CSS small caps", () => {
    const html = citationToHtml(sample);
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).toContain("font-variant:small-caps");
    expect(html).not.toContain("^^");
  });

  it("produces a clean plain-text fallback", () => {
    expect(citationToPlain(sample)).toBe(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).",
    );
  });

  it("an unterminated marker is never shown to the user", () => {
    expect(citationToPlain("Foo ^^bar")).toBe("Foo bar");
    expect(citationToHtml("Foo ^^bar")).not.toContain("^^");
    const { container } = render(
      <TooltipProvider>
        <FormattedCitation text="Foo ^^bar" />
      </TooltipProvider>,
    );
    expect(container.textContent).toBe("Foo bar");
  });
});
