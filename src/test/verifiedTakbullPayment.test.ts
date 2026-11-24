import { describe, expect, it } from "vitest";
import raw from "./fixtures/takbull-sandbox-redacted.json";
import { verifiedTakbullPayment } from "../../supabase/functions/_shared/verifiedTakbullPayment";
const expected = { orderUid:"sandbox_order_01", orderReference:"relex_order_01", merchantMid:"demo_mid", amountMinor:100, documentType:400 as const };

describe("authenticated Takbull evidence, based on an actual sandbox response", () => {
  it("matches receipt even though ValidateNotification omits document identity", () => {
    expect(verifiedTakbullPayment(expected, raw)).toMatchObject({
      transactionRef:"123", documentRef:"sandbox_receipt_01", amountMinor:100, currency:"ILS",
      providerTransactionDate:"2026-11-23T15:42:52.3154758",
    });
  });
  it.each([
    ["pending payment", (a: typeof raw) => {a.validation.internalCode=1400102;}],
    ["wrong buyer order binding", (a: typeof raw) => {a.order.order_reference="not_the_order";}],
    ["wrong merchant", (a: typeof raw) => {a.order.invoices[0].mid="other";}],
    ["incorrect amount", (a: typeof raw) => {a.order.orderTotalSum=0.99;}],
    ["authorization without charge", (a: typeof raw) => {a.order.authorizeOnly=true;}],
    ["duplicate transaction", (a: typeof raw) => {a.order.transactions.push(a.order.transactions[0]);}],
    ["refunded transaction", (a: typeof raw) => {a.order.transactions[0].refundAmount=1;}],
    ["missing receipt", (a: typeof raw) => {a.order.invoices=[];}],
    ["receipt for another transaction", (a: typeof raw) => {a.order.invoices[0].transactions[0].id=800;}],
  ] as const)("does not accept %s", (_name, change) => {
    const altered=structuredClone(raw);change(altered);
    expect(verifiedTakbullPayment(expected, altered)).toBeNull();
  });
  it("does not treat browser or webhook status as proof", () => {
    expect(verifiedTakbullPayment(expected, {merchantSettings:raw.merchantSettings,order:{statusCode:0},validation:raw.validation})).toBeNull();
  });
});
