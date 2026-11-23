const demandId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const originPath = "https://api.takbull.co.il/PaymentGateway/PaymentRequest";
export const toTakbullManualPayLink = (id: unknown) =>
  typeof id === "string" && demandId.test(id) ? `${originPath}?orderUniqId=${id.toLowerCase()}` : null;

export function isTakbullManualPayLink(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try { return raw === toTakbullManualPayLink(new URL(raw).searchParams.get("orderUniqId")); }
  catch { return false; }
}
