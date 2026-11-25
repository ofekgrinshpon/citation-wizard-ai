import { createTakbullPageObserver } from "./handler.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { settleAuthenticatedPagePayment } from "../_shared/takbullPageSettlement.ts";
import { describeRequest } from "./shape.ts";

const observer = createTakbullPageObserver({
  readActive: () => Deno.env.get("TAKBULL_PAGE_OBSERVE_ONLY") === "true",
  // Never fall back to the signing key used by the merchant-global webhook.
  readPageKey: () => Deno.env.get("TAKBULL_PAGE_WEBHOOK_HMAC_KEY"),
  record: (entry) => console.info(JSON.stringify(entry)),
  reject: (reason) => console.warn(`TAKBULL_PAGE_REJECT_V1 ${reason}`),
  settle: async (payload) => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return "unavailable";
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return settleAuthenticatedPagePayment(payload, {
      enabled: async () => {
        const { data, error } = await service.from("citation_pass_config").select("settlement_enabled").eq("singleton", true).single();
        return error ? null : data.settlement_enabled === true;
      },
      settle: async payment => {
        const { data, error } = await service.rpc("settle_citation_pass_order", {
          _reference: payment.reference, _transaction_id: payment.transactionId, _order_number: payment.orderNumber,
          _amount_ils: payment.amountIls, _currency: payment.currency, _order_status: payment.orderStatus, _status_code: payment.statusCode,
        });
        return error ? null : data;
      },
    });
  },
});

// Every request also logs one name/size/type-only shape line with the response status.
Deno.serve(async (req) => {
  let copy: Request | null = null;
  try { copy = req.clone(); } catch { /* shape logging never affects the response */ }
  const [res, shape] = await Promise.all([
    observer(req),
    copy ? describeRequest(copy).catch(() => null) : Promise.resolve(null),
  ]);
  try { console.info(JSON.stringify({ ...(shape ?? { marker: "TAKBULL_PAGE_REQUEST_SHAPE_V1", unavailable: true }), status: res.status })); } catch { /* ignore */ }
  return res;
});
