import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { UserGuideModal } from "@/components/guide/UserGuideModal";

afterEach(cleanup);

it("opens with exactly three demos and one image per active panel", () => {
  render(<UserGuideModal open onOpenChange={() => {}} />);
  const dialog = screen.getByRole("dialog");
  const tabs = within(dialog).getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["אזכור מהיר", "הערות שוליים", "ביבליוגרפיה"]);
  expect(within(dialog).getAllByRole("img")).toHaveLength(1);
  expect(within(dialog).getByRole("tabpanel")).toHaveAccessibleName("אזכור מהיר");

  fireEvent.click(tabs[1]);
  const word = within(dialog).getByRole("tabpanel");
  expect(word).toHaveAccessibleName("הערות שוליים");
  expect(within(word).getByText("בוחרים מסמך")).toBeVisible();
  expect(within(word).getByText("מאשרים ומורידים")).toBeVisible();
  expect(within(dialog).getAllByRole("img")).toHaveLength(1);
  expect(within(dialog).getAllByRole("heading", { name: /Word/ })).toHaveLength(1);

  fireEvent.keyDown(tabs[1], { key: "ArrowLeft" });
  const bibliography = within(dialog).getByRole("tabpanel");
  expect(bibliography).toHaveAccessibleName("ביבליוגרפיה");
  expect(tabs[2]).toHaveFocus();
  expect(within(bibliography).getByRole("img")).toHaveAttribute("src", expect.stringContaining("bibliography-demo.webp"));

  fireEvent.keyDown(tabs[2], { key: "Home" });
  expect(within(dialog).getByRole("tabpanel")).toHaveAccessibleName("אזכור מהיר");
  expect(tabs[0]).toHaveFocus();
});
