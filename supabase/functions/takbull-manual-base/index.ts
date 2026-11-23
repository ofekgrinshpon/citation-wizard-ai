import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleTakbullManualBase } from "./handler.ts";

Deno.serve((req) => handleTakbullManualBase(req, {
  enabled: Deno.env.get("TAKBULL_MANUAL_BASE_ENABLED") === "true",
  getUser: async (authorization) => {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  rpc: async (name, args) => {
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return await service.rpc(name, args);
  },
}));
