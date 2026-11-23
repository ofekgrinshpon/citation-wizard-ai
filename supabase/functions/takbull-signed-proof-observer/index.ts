import { createTakbullSignedProofObserver } from "./handler.ts";

// Separate user-JWT-free route required for provider. The HMAC authenticates
// this one diagnostic endpoint; do not disable auth on any other function.
Deno.serve(createTakbullSignedProofObserver({
  config: () => Deno.env.get("TAKBULL_SIGNED_PROOF_ARM"),
  key: () => Deno.env.get("TAKBULL_SIGNED_PROOF_HMAC_KEY"),
  log: (safeLine) => console.info(safeLine),
}));
