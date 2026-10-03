// A distinct function name is essential: it owns its parser CPU/memory quota.
import { extractPdfPagesBounded } from "../legal-research-v2/vendor/largePdfChunkedExtract.ts";
import { createPdfHandler } from "./handler.ts";
Deno.serve(createPdfHandler(extractPdfPagesBounded, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")));
