import { handleTakbullHostedWebhook } from "./handler.ts";

// Always closed (503, grants nothing). Observation stays dormant unless
// TAKBULL_OBSERVE_CONFIG holds a valid, currently open window of <= 30 minutes.
Deno.serve((req) =>
  handleTakbullHostedWebhook(req, {
    readConfig: () => Deno.env.get("TAKBULL_OBSERVE_CONFIG"),
    log: (line) => console.log(line),
  })
);
