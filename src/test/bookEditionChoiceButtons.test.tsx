import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookEditionChoiceButtons } from "@/components/BookEditionChoiceButtons";
import type { BookEditionChoice } from "@/lib/citationPlanner";
afterEach(cleanup);
const choice = { fingerprint: "test", options: [{ id: "1991", year: "1991", label: "1991", url: "https://example.org/book" }] } as BookEditionChoice;
describe("book edition choice buttons", () => {
  it("shows source link and locks after one applied selection", () => {
    const select = vi.fn();
    render(<BookEditionChoiceButtons choice={choice} onSelect={select} />);
    expect(screen.getByRole("link", { name: "מקור למהדורה 1991" }).getAttribute("href")).toBe("https://example.org/book");
    const button = screen.getByRole("button", { name: "1991" });
    fireEvent.click(button); fireEvent.click(button);
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("unlocks when deferred and supports keep missing", () => {
    const select = vi.fn().mockReturnValue(false);
    render(<BookEditionChoiceButtons choice={choice} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "1991" }));
    fireEvent.click(screen.getByRole("button", { name: "להשאיר את השנה חסרה" }));
    expect(select.mock.calls.map(c => c[0])).toEqual(["1991", "keep-missing"]);
  });
});
