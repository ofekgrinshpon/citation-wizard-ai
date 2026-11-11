/**
 * One-time citation pass checkout — NOT READY. Verifies the user with the auth
 * server and validates the offer, then always answers 503 without creating an
 * order, contacting a payment provider, writing data or granting anything.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCitationPassCheckout } from "./handler.ts";

Deno.serve((req) =>
  handleCitationPassCheckout(req, {
    getUser: async (authorization) => {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await sb.auth.getUser();
      if (error || !data?.user?.id) return null;
      return { id: data.user.id };
    },
  })
);
