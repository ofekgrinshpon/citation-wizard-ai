import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CitationPlanOffers } from "../components/CitationPlanOffers";
import TakbullManualBasePanel from "../components/admin/TakbullManualBasePanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

afterEach(() => { cleanup(); invoke.mockReset(); vi.unstubAllEnvs(); });
const queued = "10000000-0000-4000-a000-100000000001";
const reply = (data: object) => ({ data, error: null });
describe("payment request and status panels", () => {
  it("renders the closed state without any calls or checkout links", () => {
    vi.stubEnv("VITE_TAKBULL_MANUAL_BASE_BUYER", "");
    render(<CitationPlanOffers />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("requests only a base offer and displays issued, active real meter and refund states without a link", async () => {
    vi.stubEnv("VITE_TAKBULL_MANUAL_BASE_BUYER", "true");
    const url = "https://api.takbull.co.il/PaymentGateway/PaymentRequest?orderUniqId=abcdef01-1111-4000-a000-abcdefabcdef";
    const weekly = { ok: true, order_id: queued, offer: "citation_week_pass_v1" };
    invoke.mockResolvedValueOnce(reply({ ok: true, status: "none" }))
      .mockResolvedValueOnce(reply({ ...weekly, status: "requested" }))
      .mockResolvedValueOnce(reply({ ...weekly, status: "demand_issued", payment_url: url, payable_until: new Date(Date.now()+60000).toISOString() }))
      .mockResolvedValueOnce(reply({ ...weekly, status: "active", sources_included: 100, sources_remaining: 99, expires_at: "2026-11-30T12:00:00Z" }))
      .mockResolvedValueOnce(reply({ ...weekly, status: "refunded" }));
    render(<CitationPlanOffers />);
    const weeklyButton = screen.getByRole("button", { name: /בקש קישור תשלום עבור.*7/ });
    await waitFor(() => expect(weeklyButton).toBeEnabled());
    fireEvent.click(weeklyButton);
    expect(await screen.findByText(/הבקשה התקבלה/)).toBeInTheDocument();
    expect(invoke).toHaveBeenNthCalledWith(2, "takbull-manual-base", { body: { action: "request", offer: "citation_week_pass_v1" } });
    expect(weeklyButton).toBeDisabled();
    const refresh = screen.getByRole("button", { name: "רענן סטטוס" });
    fireEvent.click(refresh);
    expect(await screen.findByText(/דרישת התשלום הונפקה/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לתשלום מאובטח בתקבול" })).toHaveAttribute("href",url);
    fireEvent.click(refresh);
    expect(await screen.findByText("נותרו 99 מתוך 100 מקורות")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(refresh);
    expect(await screen.findByText("החזר התשלום נרשם.")).toBeInTheDocument();
    expect(screen.queryByText(/נותרו /)).not.toBeInTheDocument();
  });
  it("does not render a mismatched origin or expired payment link", async () => {
    vi.stubEnv("VITE_TAKBULL_MANUAL_BASE_BUYER", "true");
    const id = "abcdef01-1111-4000-a000-abcdefabcdef";
    invoke.mockResolvedValueOnce(reply({ok:true,status:"demand_issued",payment_url:"https://evil.invalid/?orderUniqId="+id,
      payable_until:new Date(Date.now()+60000).toISOString()}))
      .mockResolvedValueOnce(reply({ok:true,status:"demand_issued",
        payment_url:"https://api.takbull.co.il/PaymentGateway/PaymentRequest?orderUniqId="+id,
        payable_until:new Date(Date.now()-1000).toISOString()}));
    render(<CitationPlanOffers />);
    await screen.findByText(/דרישת התשלום הונפקה/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"רענן סטטוס"}));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("loads the operator queue, refuses mismatched observed order locally, and requests no activation without matching proof", async () => {
    invoke.mockResolvedValueOnce(reply([{order_id: queued, amount_minor: 3900, demand_ref: null}]));
    render(<TakbullManualBasePanel />);
    fireEvent.click(screen.getByRole("button", { name: "טען בקשות תשלום" }));
    await screen.findByRole("option", { name: /בקשה חדשה/ });
    fireEvent.change(screen.getByRole("combobox", { name: "הזמנה" }), { target: { value: queued } });
    const form = screen.getByRole("button", { name: "אישור ותיעוד" }).closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText(/לא תואם להזמנה/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
