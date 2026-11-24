/** Pure validation for data read with server-owned Takbull API credentials.
 * Never pass the redirect, iframe event, or a webhook as any of these replies.
 * Recognizes an order and receipt; intentionally cannot grant an entitlement.
 */
type Row = Record<string, unknown>;
type Expected = {
  orderUid: string;
  orderReference: string;
  merchantMid: string;
  amountMinor: number;
  documentType: 400 | 320;
};
type Evidence = {
  orderUid: string;
  orderReference: string;
  merchantMid: string;
  transactionRef: string;
  documentRef: string;
  amountMinor: number;
  currency: "ILS";
  /** Provider wire value: may lack a timezone; do not use as an instant without confirming the contract. */
  providerTransactionDate: string;
};
const row = (v: unknown): Row | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Row : null;
const one = (v: unknown): Row | null => Array.isArray(v) && v.length === 1 ? row(v[0]) : null;
const ref = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9_-]{1,128}$/i.test(s);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const hasAmount = (n: unknown, cents: number) => typeof n === "number" && Number.isFinite(n) && n === cents / 100;

export function verifiedTakbullPayment(expected: Expected, replies: {
  merchantSettings: unknown;
  order: unknown;
  validation: unknown;
}): Evidence | null {
  const m = row(replies.merchantSettings), o = row(replies.order), v = row(replies.validation);
  if (!m || !o || !v || !id(expected.amountMinor) || !ref(expected.orderUid) ||
      !ref(expected.orderReference) || !ref(expected.merchantMid) ||
      (expected.documentType !== 400 && expected.documentType !== 320)) return null;
  if (m.success !== true || m.errorCode !== 0 || m.mid !== expected.merchantMid) return null;
  if (o.uniqId !== expected.orderUid || o.order_reference !== expected.orderReference ||
      o.orderStatus !== 3 || o.currency !== "ILS" || !hasAmount(o.orderTotalSum, expected.amountMinor) ||
      o.dealType !== 1 || o.numberOfPayments !== 1 || o.authorizeOnly !== false ||
      o.saveToken !== false || o.createDocument !== true || o.documentType !== expected.documentType) return null;
  // ValidateNotification uses a different status enum from GetOrder.transactions.
  // Its documentId and orderId do not reliably mirror the created receipt/order in sandbox.
  if (v.internalCode !== 0 || v.providerCode !== 0 || v.orderStatus !== 3 ||
      v.tranSactionStatus !== 0 || v.dealType !== 1 || v.isSubscriptionPayment !== false ||
      !hasAmount(v.amount, expected.amountMinor)) return null;
  const tx = one(o.transactions), doc = one(o.invoices);
  if (!tx || !doc || !id(tx.id) || !ref(tx.transactionId) ||
      tx.status !== 1 || tx.statusCode !== 0 || tx.transactionType !== 10 || tx.dealType !== 1 ||
      tx.numberOfPayments !== 1 || tx.refundAmount !== 0 || tx.currency !== "ILS" ||
      !hasAmount(tx.amount, expected.amountMinor) || tx.isDocumentCreated !== true ||
      typeof tx.transactionDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?$/.test(tx.transactionDate)) return null;
  const docTx = one(doc.transactions);
  if (!id(doc.id) || !ref(doc.uniqId) || tx.invoiceId !== doc.id ||
      !(id(doc.documentNumber) || ref(doc.documentNumber)) || doc.documentNumber !== tx.documentNumber ||
      doc.mid !== expected.merchantMid || doc.currency !== "ILS" ||
      doc.documentType !== expected.documentType || doc.isDocumentOpen !== false ||
      doc.isNegativeDocument !== false || doc.isTemplate !== false ||
      !hasAmount(doc.totalPriceWithTax, expected.amountMinor) || !docTx ||
      docTx.id !== tx.id || docTx.transactionId !== tx.transactionId) return null;
  return {
    orderUid: expected.orderUid, orderReference: expected.orderReference, merchantMid: expected.merchantMid,
    transactionRef: String(tx.id), documentRef: doc.uniqId, amountMinor: expected.amountMinor,
    currency: "ILS", providerTransactionDate: tx.transactionDate,
  };
}
