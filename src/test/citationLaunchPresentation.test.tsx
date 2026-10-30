import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CITATION_OFFERS } from "@/lib/citationOffers";
import { LaunchPricing } from "@/components/launch/LaunchPricing";
import { UserGuideModal } from "@/components/guide/UserGuideModal";

afterEach(cleanup);

describe("citation launch presentation", () => {
  it("does not reinterpret old credit plans as recurring source offers", () => {
    const { container } = render(<LaunchPricing />);
    expect(container.textContent).not.toContain("₪29");
    expect(container.textContent).not.toContain("₪69");
    expect(container.textContent).not.toContain("סמסטר");
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("renders the selected canonical offer labels and allowances without checkout", () => {
    render(<LaunchPricing />);
    for (const offer of CITATION_OFFERS) {
      expect(screen.getByText(offer.label)).toBeInTheDocument();
      expect(screen.getByText(offer.priceLabel)).toBeInTheDocument();
      expect(screen.getByText(offer.allowanceLabel)).toBeInTheDocument();
    }
    expect(screen.getByText("₪39 לשבוע")).toBeInTheDocument();
    expect(screen.getByText("₪65 לחודש")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("keeps review guidance and keyboard tabs without advertising research or the old video", () => {
    const { container } = render(<UserGuideModal open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "העוזר המשפטי" })).not.toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("בהכנה להשקה")).toBeInTheDocument();
    expect(screen.getByText(/יתר הטקסט יישלח למנוע האזכור/)).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
