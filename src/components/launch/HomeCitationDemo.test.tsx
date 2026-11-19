import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeCitationDemo } from "./HomeCitationDemo";
afterEach(cleanup);

function show() {
  render(<HomeCitationDemo />);
  return {
    field: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "פרטי המקור לדוגמה"}),
    arrow: screen.getByRole("button", {name: "הצגת האזכור לדוגמה"}),
    box: screen.getByRole("region", {name: "נסו אזכור מהיר"}),
  };
}

describe("fixed homepage example", () => {
  it("has a read-only sample and the arrow expands the same box", () => {
    const { field, arrow, box } = show();
    expect(field.readOnly).toBe(true);
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/בנק המזרחי המאוחד/)).toBeNull();
    fireEvent.click(arrow);
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
    expect(box.contains(screen.getByText(/בנק המזרחי המאוחד/))).toBe(true);
    expect(screen.queryByText("ReLex · אזכור לדוגמה")).toBeNull();
    expect(box.textContent).toContain("פס׳ 3 לפסק דינו של הנשיא ברק (1995).");
  });
  it("reveals with Enter, but not an unrelated key", () => {
    const { field, arrow } = show();
    fireEvent.keyDown(field, {key: "א"});
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(field, {key: "Enter"});
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
  });
});
