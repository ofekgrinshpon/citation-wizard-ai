import { readTakbullPagePayment, type TakbullPagePayment } from "./takbullPagePayment.ts";

export interface PageSettlementDeps {
  enabled: () => Promise<boolean | null>;
  settle: (payment: TakbullPagePayment) => Promise<{ ok: boolean; disabled?: boolean } | null>;
}
/** Authentication belongs to the enclosing raw-body HMAC handler, not the payload. */
export async function settleAuthenticatedPagePayment(payload: unknown, deps: PageSettlementDeps): Promise<"disabled" | "accepted" | "rejected" | "unavailable"> {
  try {
    const enabled = await deps.enabled();
    if (enabled === null) return "unavailable";
    if (!enabled) return "disabled";
    const payment = readTakbullPagePayment(payload);
    if (!payment) return "rejected";
    const result = await deps.settle(payment);
    if (!result) return "unavailable";
    if (result.disabled === true) return "disabled";
    return result.ok === true ? "accepted" : "rejected";
  } catch { return "unavailable"; }
}