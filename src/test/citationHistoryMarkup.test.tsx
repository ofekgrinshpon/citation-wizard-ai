import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { citationHistoryHtml } from "@/lib/citationHistoryMarkup";
import { CitationHistorySidebar } from "@/components/CitationHistorySidebar";

const state = vi.hoisted(() => ({ output: "", from: vi.fn(), user: { id: "owner" } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from } }));

beforeEach(() => {
  state.from.mockReset();
  state.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query,
      limit: async () => ({ data: [{ id: "history", raw_input: "Synthetic", formatted_output: state.output,
        source_type: "article", is_verified: false, created_at: "2026-10-13T00:00:00Z" }], error: null }) };
    return query;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("history HTML boundary", () => {
  it.each([
    '<img src=x onerror="alert(1)">', '<svg onload="alert(1)"></svg>',
    '<script>alert(1)</script>', '**<img src=x onerror="alert(1)">**',
    '<a href="javascript:alert(1)">לחץ</a>', '</div><iframe src="https://fixture.invalid"></iframe>',
    '&lt;img src=x onerror=alert(1)&gt;', '״<b>פסק דין</b>״ & שלום',
  ])("renders markup as text without creating active elements: %s", (input) => {
    const container = document.createElement("div");
    container.innerHTML = citationHistoryHtml(input);
    expect(container.querySelectorAll("script,img,svg,a,iframe,object,style")).toHaveLength(0);
    expect(container.textContent).toBe(input.replace(/\*\*/g, ""));
    for (const node of Array.from(container.querySelectorAll("*"))) expect(node.attributes).toHaveLength(0);
  });

  it("preserves Hebrew, numbers, URL ampersands and intended emphasis", () => {
    const value = '**שלום & עולם** *דין* _מאמר_ https://fixture.invalid/?a=1&b=2 193–214';
    const container = document.createElement("div");
    container.innerHTML = citationHistoryHtml(value);
    expect(container.querySelector("b")?.textContent).toBe("שלום & עולם");
    expect(Array.from(container.querySelectorAll("i")).map((node) => node.textContent)).toEqual(["דין", "מאמר"]);
    expect(container.textContent).toContain("https://fixture.invalid/?a=1&b=2 193–214");
    expect(value).toContain("**שלום & עולם**");
  });

  it("keeps entity-looking source text literal rather than decoding it twice", () => {
    const container = document.createElement("div");
    container.innerHTML = citationHistoryHtml('A & B &amp; C &#60; D');
    expect(container.textContent).toBe('A & B &amp; C &#60; D');
  });

  it("protects the actual sidebar display without changing the history query", async () => {
    state.output = '**פסק דין** <img src=x onerror="alert(1)">';
    const ui = render(<CitationHistorySidebar projectId="project" />);
    await waitFor(() => expect(screen.getByText("פסק דין")).toBeInTheDocument());
    expect(ui.container.querySelector("img")).toBeNull();
    expect(ui.container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(state.from).toHaveBeenCalledWith("citation_history");
  });

  it("escapes the actual HTML clipboard while preserving literal plain text", async () => {
    class ClipboardFixture {
      constructor(readonly values: Record<string, Blob>) {}
    }
    const write = vi.fn(async () => {});
    vi.stubGlobal("ClipboardItem", ClipboardFixture);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    state.output = '**שלום & עולם** <img src=x onerror="alert(1)">';
    const ui = render(<CitationHistorySidebar projectId="project" />);
    const button = await screen.findByTitle("לחץ להעתקה");
    fireEvent.click(button);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item = (write.mock.calls[0] as unknown as [ClipboardFixture[]])[0][0];
    const read = (blob: Blob) => new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    const html = await read(item.values["text/html"]);
    const plain = await read(item.values["text/plain"]);
    const copied = document.createElement("div"); copied.innerHTML = html;
    expect(copied.querySelector("img")).toBeNull();
    expect(copied.querySelector("b")?.textContent).toBe("שלום & עולם");
    expect(copied.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(plain).toBe('שלום & עולם <img src=x onerror="alert(1)">');
    expect(ui.container.querySelector("img")).toBeNull();
  });
});
