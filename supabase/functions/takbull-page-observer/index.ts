import { createTakbullPageObserver } from "./handler.ts";

Deno.serve(createTakbullPageObserver({
  readActive: () => Deno.env.get("TAKBULL_PAGE_OBSERVE_ONLY") === "true",
  // Never fall back to the signing key used by the merchant-global webhook.
  readPageKey: () => Deno.env.get("TAKBULL_PAGE_WEBHOOK_HMAC_KEY"),
  record: (entry) => console.info(JSON.stringify(entry)),
}));
