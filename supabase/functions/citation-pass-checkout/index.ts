import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCitationPassCheckout } from "./handler.ts";

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return handleCitationPassCheckout(req, { getUser: async () => null });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleCitationPassCheckout(req, {
    getUser: async (authorization) => {
      const sb = createClient(url, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await sb.auth.getUser();
      if (error || !data?.user?.id) return null;
      return { id: data.user.id };
    },
    getConfig: async authorization => {
      const authenticated = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: readiness, error: readinessError } = await authenticated.rpc("get_citation_checkout_status");
      const { data, error } = await service.from("citation_pass_config").select("checkout_enabled,settlement_enabled,page_url").eq("singleton", true).single();
      if (error || readinessError) throw new Error("CONFIG_UNAVAILABLE");
      return { enabled: readiness?.enabled === true && data.settlement_enabled === true, pageUrl: data.page_url };
    },
    createOrder: async (userId, offerId) => {
      const { data, error } = await service.rpc("create_citation_pass_order", { _user_id: userId, _offer_id: offerId });
      if (error || data?.ok !== true || typeof data.reference !== "string" || typeof data.order_id !== "string" || typeof data.page_url !== "string") return null;
      return { reference: data.reference, orderId: data.order_id, pageUrl: data.page_url };
    },
  });
});
