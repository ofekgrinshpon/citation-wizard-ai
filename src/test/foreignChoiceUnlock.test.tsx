/** Case-choice buttons lock only while a choice is being applied. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForeignCaseChoiceButtons } from "@/components/ForeignCaseChoiceButtons";

const choice = {
  version: 1, stage: "decision", jurisdiction: "US", fingerprint: "x", decisions: [], plan: {}, response: {},
  options: [
    { id: "US|a", label: "347 U.S. 483 (1954)", url: "https://www.courtlistener.com/opinion/1/" },
    { id: "US|b", label: "349 U.S. 294 (1955)", url: "https://law.justia.com/cases/federal/us/349/294/" },
  ],
} as never;

describe("foreign case choice buttons", () => {
  it("unlock again when the choice was not applied, so the user can pick again", () => {
    const onSelect = vi.fn().mockReturnValueOnce(false).mockReturnValue(undefined);
    render(<ForeignCaseChoiceButtons choice={choice} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "1. 347 U.S. 483 (1954)" }));
    expect(screen.getByRole("button", { name: "2. 349 U.S. 294 (1955)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "2. 349 U.S. 294 (1955)" }));
    expect(onSelect).toHaveBeenLastCalledWith("US|b");
    expect(screen.getByRole("button", { name: "1. 347 U.S. 483 (1954)" })).toBeDisabled();
  });
});
