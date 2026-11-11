import { handleTakbullHostedWebhook } from "./handler.ts";

// Closed until signed callback verification exists. Never reads the body.
Deno.serve((req) => handleTakbullHostedWebhook(req));
