import { describe, expect, it } from "vitest";
import { pageCheckoutUrl, readTakbullPagePayment } from "../../supabase/functions/_shared/takbullPagePayment";

const payment = { ExternalCustomerId: `rlx_${"a".repeat(32)}`, TransactionId: 101, OrderNumber: 8,
  OrderTotalSum: 39, OrderStatus: 2, StatusCode: 0 };

describe("dedicated signed page payment projection", () => {
  it("maps exactly 39 ILS to the weekly pass", () => {
    expect(readTakbullPagePayment({ ...payment, Currency: "ILS" })).toMatchObject({ amountIls: 39, offerId: "citation_week_pass_v1", currency: "ILS" });
  });
  it("maps exactly 65 ILS to the calendar-month pass", () => {
    expect(readTakbullPagePayment({ ...payment, OrderTotalSum: 65 })).toMatchObject({ amountIls: 65, offerId: "citation_month_pass_v1", currency: null });
  });
  it("rejects other prices and nonnumeric amounts", () => {
    for (const OrderTotalSum of [1, 15, 38.99, 39.01, 3900, "39", null]) expect(readTakbullPagePayment({ ...payment, OrderTotalSum })).toBeNull();
  });
  it("accepts observed page order status 3 without changing the status sent to settlement", () => {
    expect(readTakbullPagePayment({ ...payment, OrderStatus: 3 })).toMatchObject({ orderStatus: 3, statusCode: 0 });
  });
  it("accepts the observed explicit null action", () => {
    expect(readTakbullPagePayment({ ...payment, OrderStatus: 3, Action: null })).toMatchObject({ orderStatus: 3 });
  });
  it("requires completed order 2 or 3 and successful processing 0 together", () => {
    for (const OrderStatus of [0, 1, 4, 5, "2", "3", null, undefined]) expect(readTakbullPagePayment({ ...payment, OrderStatus })).toBeNull();
    for (const StatusCode of [1, "0", undefined]) expect(readTakbullPagePayment({ ...payment, StatusCode })).toBeNull();
    expect(readTakbullPagePayment({ ...payment, OrderStatus: 3, StatusCode: 1, Action: null })).toBeNull();
  });
  it("does not accept a refund or subscription as a purchase", () => {
    expect(readTakbullPagePayment({ ...payment, Action: "Refund" })).toBeNull();
    for (const Action of ["Void", "", 0, false, undefined]) expect(readTakbullPagePayment({ ...payment, OrderStatus: 3, Action })).toBeNull();
    expect(readTakbullPagePayment({ ...payment, IsSubscriptionPayment: true })).toBeNull();
  });
  it("rejects explicit non-ILS or malformed currency", () => {
    for (const Currency of ["USD", "ils", null, 1]) expect(readTakbullPagePayment({ ...payment, Currency })).toBeNull();
  });
  it("requires a purchase-specific opaque reference, not an account or order ordinal", () => {
    for (const ExternalCustomerId of ["8", "user-1", "rlx_ord_abc", undefined]) expect(readTakbullPagePayment({ ...payment, ExternalCustomerId })).toBeNull();
  });
  it("requires positive exact transaction and order identifiers", () => {
    for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, "001", null, undefined]) {
      expect(readTakbullPagePayment({ ...payment, TransactionId: id })).toBeNull();
      expect(readTakbullPagePayment({ ...payment, OrderNumber: id })).toBeNull();
    }
    expect(readTakbullPagePayment({ ...payment, TransactionId: "123" })?.transactionId).toBe("123");
  });
  it("does not copy customer or card information", () => {
    expect(readTakbullPagePayment({ ...payment, CustomerEmail: "never-copy@example.test", Token: "never-copy" })).toEqual(readTakbullPagePayment(payment));
  });
  it("uses only the configured page URL and a unique c_id", () => {
    // Synthetic URL: this is not a claimed Takbull production route.
    expect(pageCheckoutUrl("https://test.takbull.co.il/test/3CxDl", payment.ExternalCustomerId)).toBe(`https://test.takbull.co.il/test/3CxDl?c_id=${payment.ExternalCustomerId}`);
    for (const url of ["https://evil.test/3CxDl", "http://test.takbull.co.il/3CxDl", "https://test.takbull.co.il/other", "https://test.takbull.co.il/3CxDl?amount=1"]) expect(pageCheckoutUrl(url, payment.ExternalCustomerId)).toBeNull();
  });
});