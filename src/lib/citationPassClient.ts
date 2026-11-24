import { supabase } from "@/integrations/supabase/client";
import { findCitationPassOffer, type CitationPassOfferId } from "../../supabase/functions/_shared/citationPassOffers";

type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const rpc = supabase as unknown as Rpc;
export interface CitationPassStatus {
  id: string;
  offerId: CitationPassOfferId;
  status: "pending" | "active" | "expired" | "exhausted";
  activatedAt: string | null;
  expiresAt: string | null;
  usedRatio: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export async function citationCheckoutReady(): Promise<boolean> {
  const { data, error } = await rpc.rpc("get_citation_checkout_status");
  return !error && record(data)?.enabled === true;
}
export async function citationPassStatus(): Promise<CitationPassStatus[]> {
  const { data, error } = await rpc.rpc("get_citation_pass_status");
  const r = record(data);
  if (error || r?.ok !== true || !Array.isArray(r.passes)) throw new Error("PASS_STATUS_UNAVAILABLE");
  return r.passes.map(value => {
    const p = record(value);
    const offer = findCitationPassOffer(p?.offer_id);
    const status = p?.status;
    if (!p || !offer || typeof p.id !== "string" || !["pending", "active", "expired", "exhausted"].includes(String(status)) ||
        typeof p.used_ratio !== "number" || !Number.isFinite(p.used_ratio) || p.used_ratio < 0 || p.used_ratio > 1 ||
        (p.expires_at !== null && (typeof p.expires_at !== "string" || !Number.isFinite(Date.parse(p.expires_at)))) ||
        (p.activated_at !== null && (typeof p.activated_at !== "string" || !Number.isFinite(Date.parse(p.activated_at))))) throw new Error("INVALID_PASS_STATUS");
    return { id: p.id, offerId: offer.id, status: status as CitationPassStatus["status"],
      activatedAt: p.activated_at as string | null, expiresAt: p.expires_at as string | null, usedRatio: p.used_ratio };
  });
}
export async function startCitationPassCheckout(offerId: CitationPassOfferId): Promise<string> {
  const { data, error } = await supabase.functions.invoke("citation-pass-checkout", { body: { offerId } });
  if (error || !data || typeof data.checkoutUrl !== "string" || data.activated !== false) throw new Error("CHECKOUT_UNAVAILABLE");
  const url = new URL(data.checkoutUrl);
  if (url.origin !== "https://paypage.takbull.co.il" || url.pathname !== "/3CxDl" || url.hash ||
      [...url.searchParams.keys()].length !== 1 || !/^rlx_[0-9a-f]{32}$/.test(url.searchParams.get("c_id") ?? "")) throw new Error("INVALID_CHECKOUT_URL");
  return url.href;
}