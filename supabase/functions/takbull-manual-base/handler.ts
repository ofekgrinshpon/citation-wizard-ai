import { toTakbullManualPayLink } from "../_shared/takbullManualPayLink.ts";

type Args = Record<string, string | number | null>;
type Dependencies = {
  enabled: boolean;
  getUser: (authorization: string) => Promise<string | null>;
  rpc: (name: string, args: Args) => Promise<{ data: unknown; error: { code?: string } | null }>;
};
const offers = new Set(["citation_week_pass_v1", "citation_month_pass_v1"]);
const id = /^[a-zA-Z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const stamped = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const is = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const validStamp = (value: unknown): value is string => is(value, stamped) && Number.isFinite(Date.parse(value));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
function respond(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export async function handleTakbullManualBase(req: Request, deps: Dependencies): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD" });
  if (!deps.enabled) return respond(503, { ok: false, code: "DISABLED" });
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer [^\s]+$/i.test(auth)) return respond(401, { ok: false, code: "SIGN_IN" });
  try {
    const actor = await deps.getUser(auth);
    if (!is(actor, uuid)) return respond(401, { ok: false, code: "SIGN_IN" });
    const raw = await req.text();
    if (raw.length > 4096) return respond(413, { ok: false, code: "BAD_REQUEST" });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond(400, { ok: false, code: "BAD_REQUEST" });
    const bad = () => respond(400, { ok: false, code: "BAD_REQUEST" });
    const { action } = body;
    let name: string;
    let args: Args;
    if (action === "request" || action === "status") {
      if (action === "request" && !offers.has(body.offer)) return bad();
      name = "takbull_manual_base_intent";
      args = { _owner: actor, _offer: action === "request" ? body.offer : null };
    } else if (action === "queue") {
      name = "takbull_manual_base_queue";
      args = { _actor: actor };
    } else {
      if (!is(body.order, uuid) || typeof body.merchant !== "string" || !body.merchant || body.merchant.length > 128 ||
          body.attest !== true) return bad();
      const evidence = { _actor: actor, _merchant: body.merchant };
      const money = [3900, 6500].includes(body.amountMinor) && body.currency === "ILS";
      if (action === "issue") {
        if (!money || !is(body.demand, uuid) || !validStamp(body.at)) return bad();
        name = "takbull_manual_base_issue";
        args = { _actor: actor, _order: body.order, _observed_merchant: body.merchant, _amount_minor: body.amountMinor, _currency: body.currency, _demand_ref: body.demand, _issued_at: body.at };
      } else if (action === "settle") {
        if (!money || !is(body.demand, id) || !is(body.transaction, id) || !is(body.document, id) || !validStamp(body.at)) return bad();
        name = "takbull_manual_base_settle";
        args = { ...evidence, _observed_order: body.order, _observed_demand: body.demand, _transaction: body.transaction, _document: body.document, _amount_minor: body.amountMinor, _currency: body.currency, _outcome: "confirmed_one_time_charge", _paid_at: body.at };
      } else if (action === "refund") {
        if (!is(body.transaction, id) || !is(body.refund, id) || !is(body.document, id)) return bad();
        name = "takbull_manual_base_refund";
        args = { ...evidence, _order: body.order, _original_transaction: body.transaction, _refund_ref: body.refund, _credit_document: body.document, _outcome: "confirmed_full_refund" };
      } else return bad();
    }
    const { data, error } = await deps.rpc(name, args);
    if (error) return respond(error.code === "42501" ? 403 : 503, { ok: false, code: error.code === "42501" ? "FORBIDDEN" : "UNAVAILABLE" });
    if (name === "takbull_manual_base_intent" && data && typeof data === "object") {
      const { payable_provider_id, payable_until, payment_url: _ignored, ...safe } = data as Record<string, unknown>;
      const url = safe.status === "demand_issued" && validStamp(payable_until) &&
        Date.parse(payable_until) > Date.now() ? toTakbullManualPayLink(payable_provider_id) : null;
      return respond(200, { ...safe, ...(url ? { payment_url: url, payable_until } : {}) });
    }
    return respond(200, data);
  } catch (err) {
    return err instanceof SyntaxError ? respond(400, { ok: false, code: "BAD_REQUEST" }) : respond(503, { ok: false, code: "UNAVAILABLE" });
  }
}
