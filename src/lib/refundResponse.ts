import { toast } from "sonner";

export interface MaybeRefundedResponse {
  refunded?: boolean;
  refundReason?: string;
  error?: string;
  remaining_included?: number;
  remaining_topup?: number;
}

/**
 * Inspects an edge-function response. If the server returned `refunded: true`,
 * shows the standard Hebrew refund toast and returns true.
 */
export function handleRefundResponse(payload: unknown): boolean {
  const r = (payload ?? {}) as MaybeRefundedResponse;
  if (r?.refunded) {
    toast.info("הפעולה נכשלה והשימוש הוחזר למכסה אוטומטית", {
      description: r.refundReason || undefined,
    });
    return true;
  }
  return false;
}

export function isInsufficientCredits(payload: unknown): boolean {
  const r = (payload ?? {}) as MaybeRefundedResponse;
  return r?.error === "INSUFFICIENT_CREDITS";
}
