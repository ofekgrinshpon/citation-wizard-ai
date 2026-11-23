import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WordLaunchGuide } from "@/components/launch/WordLaunchGuide";

afterEach(cleanup);

it("describes the Word workflow in three ordered steps", () => {
  render(<WordLaunchGuide />);
  const guide = screen.getByRole("region", { name: "מקובץ Word לעותק מתוקן בשלושה צעדים" });
  const cards = within(guide).getAllByRole("listitem");
  expect(cards.map((item) => within(item).getByRole("heading").textContent)).toEqual([
    "מעלים קובץ Word", "בודקים ומאשרים", "מורידים עותק מתוקן",
  ]);
  expect(within(guide).queryByText(/בהכנה להשקה/)).not.toBeInTheDocument();
  expect(within(cards[2]).getByText(/הקובץ המקורי לא משתנה/)).toBeInTheDocument();
});
