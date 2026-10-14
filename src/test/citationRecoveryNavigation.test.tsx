import { MemoryRouter } from "react-router-dom";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });
import { readFileSync } from "node:fs";
import { CitationRequestStatusLink } from "@/components/CitationRequestStatusLink";

afterEach(cleanup);
describe("recovery navigation", () => {
  it("exposes a read-only exact-request destination", () => {
    render(<CitationRequestStatusLink requestId="request:1234" />);
    expect(screen.getByRole("link", { name: "בדיקת מצב הבקשה" })).toHaveAttribute("href", "/citation-recovery?requestId=request%3A1234");
  });
  it.each([undefined, "", "short", "https://evil.example", "<script>"])("does not link malformed handles: %s", (requestId) => {
    render(<CitationRequestStatusLink requestId={requestId} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("keeps recovery in desktop and profile history rather than the main header", () => {
    const index = readFileSync("src/pages/Index.tsx", "utf8");
    const header = index.slice(index.indexOf("{/* Header */}"), index.indexOf("{/* Mode tabs"));
    expect(header).not.toContain("citation-recovery");
    expect(index).toContain('user && isOfficeAddin && <footer');
    expect(index).toContain('to="/profile?tab=history"');
    for (const path of ["src/components/CitationHistorySidebar.tsx", "src/pages/Profile.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('to="/citation-recovery"');
      expect(source).toContain("מצב בקשות אזכור");
    }
  });
});
