import { findCitationPassOffer, type CitationPassOfferId } from "./citationPassOffers.ts";

/** Only called AFTER verification with the dedicated page's HMAC key. */
export interface TakbullPagePayment {
  reference: string;
  transactionId: string;
  orderNumber: string;
  amountIls: 39 | 65;
  currency: "ILS" | null;
  orderStatus: 2;
  statusCode: 0;
  offerId: CitationPassOfferId;
}

function positiveId(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
}

export function readTakbullPagePayment(value: unknown): TakbullPagePayment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(o, key);
  if (typeof o.ExternalCustomerId !== "string" || !/^rlx_[0-9a-f]{32}$/.test(o.ExternalCustomerId)) return null;
  const transactionId = positiveId(o.TransactionId);
  const orderNumber = positiveId(o.OrderNumber);
  if (!transactionId || !orderNumber || o.OrderStatus !== 2 || o.StatusCode !== 0) return null;
  if (has("Action") && o.Action !== "Charge") return null;
  if (has("IsSubscriptionPayment") && o.IsSubscriptionPayment !== false) return null;
  // Absent currency is accepted only by the server's pinned ILS-page contract.
  // Explicit conflicting, null or malformed currency never qualifies.
  if (has("Currency") && o.Currency !== "ILS") return null;
  const amountIls = o.OrderTotalSum;
  if (amountIls !== 39 && amountIls !== 65) return null;
  const offerId = amountIls === 39 ? "citation_week_pass_v1" : "citation_month_pass_v1";
  const offer = findCitationPassOffer(offerId);
  if (!offer || offer.priceIls !== amountIls) return null;
  return { reference: o.ExternalCustomerId, transactionId, orderNumber, amountIls,
    currency: has("Currency") ? "ILS" : null, orderStatus: 2, statusCode: 0, offerId };
}

/** The configured owner-supplied URL, never a guessed payment route. */
export function pageCheckoutUrl(pageUrl: unknown, reference: unknown): string | null {
  if (typeof pageUrl !== "string" || typeof reference !== "string" || !/^rlx_[0-9a-f]{32}$/.test(reference)) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search ||
        !(url.hostname === "takbull.co.il" || url.hostname.endsWith(".takbull.co.il")) ||
        url.pathname.split("/").filter(Boolean).at(-1) !== "3CxDl") return null;
    url.searchParams.set("c_id", reference);
    return url.href;
  } catch { return null; }
}