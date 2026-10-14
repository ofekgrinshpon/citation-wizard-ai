import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { citationRecoveryInput, citationRecoveryResult, citationRecoveryQuery, recoveryObject, CITATION_RECOVERY_TTL_MS } from "../_shared/citationRecovery.ts";
import { citationRefundReceipt } from "../_shared/citationUsageGuard.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store, private",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

// Gateway defaults are intentionally unchanged. JWT verification and ownership
// are mandatory inside this endpoint, including when invoked without a gateway.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim()) return reply({ error: "UNAUTHORIZED" }, 401);
  try {
    const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(authorization.slice(7));
    const owner = claimsData?.claims?.sub;
    if (claimsError || typeof owner !== "string" || !owner) return reply({ error: "UNAUTHORIZED" }, 401);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return reply({ error: "INVALID_RECOVERY_QUERY" }, 400);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return reply({ error: "INVALID_RECOVERY_QUERY" }, 400); }
    const query = citationRecoveryQuery(parsed);
    if (!query) return reply({ error: "INVALID_RECOVERY_QUERY" }, 400);
    // No owner ID from the body, no table/client-history/cache/provider reads,
    // and no begin/finish/refund RPC. A lost acknowledgement is just another read.
    const service = createClient(url, serviceKey);
    const { data, error } = await service.rpc("read_citation_recovery", {
      _user_id: owner, _request_id: query.requestId ?? null,
      _parent_request_id: query.parentRequestId ?? null, _cursor: query.cursor ?? null, _limit: query.limit,
    });
    if (error) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
    if (recoveryObject(data) && data.error === "INVALID_RECOVERY_CURSOR") return reply({ error: "INVALID_RECOVERY_CURSOR" }, 400);
    if (!recoveryObject(data) || !Array.isArray(data.requests) || data.requests.length > query.limit ||
        (data.nextCursor !== null && (typeof data.nextCursor !== "string" || data.nextCursor.length < 8 || data.nextCursor.length > 200)) ||
        ((query.requestId || query.parentRequestId) && (data.requests.length > 1 || data.nextCursor !== null))) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
    const requests: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const now = Date.now();
    for (const row of data.requests) {
      if (!recoveryObject(row) || typeof row.requestId !== "string" || row.requestId.length < 8 || row.requestId.length > 200 || seen.has(row.requestId) ||
          !(row.retryOfRequestId === null || (typeof row.retryOfRequestId === "string" && row.retryOfRequestId.length >= 8 && row.retryOfRequestId.length <= 200)) ||
          !["in_progress", "succeeded", "failed", "unknown"].includes(String(row.status)) ||
          typeof row.createdAt !== "string" || typeof row.expiresAt !== "string" ||
          !["available", "pending", "expired", "unavailable"].includes(String(row.availability)) ||
          (query.requestId && row.requestId !== query.requestId) || (query.parentRequestId && row.retryOfRequestId !== query.parentRequestId)) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
      const created = Date.parse(row.createdAt), expires = Date.parse(row.expiresAt);
      if (!Number.isFinite(created) || !Number.isFinite(expires) || expires - created !== CITATION_RECOVERY_TTL_MS) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
      const refundReceipt = citationRefundReceipt(row.refundReceipt);
      if (!refundReceipt) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
      const expired = now >= expires || row.availability === "expired";
      const input = expired || row.input === null ? null : citationRecoveryInput(row.input);
      const result = expired || row.result === null || row.status !== "succeeded" ? null : citationRecoveryResult(row.result);
      const availability = expired ? "expired" : !input ? "unavailable" : row.status === "in_progress" ? "pending"
        : row.status === "succeeded" && !result ? "unavailable" : "available";
      seen.add(row.requestId);
      requests.push({ requestId: row.requestId, retryOfRequestId: row.retryOfRequestId, status: row.status,
        createdAt: row.createdAt, expiresAt: row.expiresAt, availability,
        input: availability === "unavailable" ? null : input, result: availability === "unavailable" ? null : result, refundReceipt });
    }
    if (data.nextCursor !== null && data.nextCursor !== requests.at(-1)?.requestId) return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
    return reply({ requests, nextCursor: data.nextCursor });
  } catch {
    // No diagnostics or account data are exposed, and reads never compensate a
    // missing response with a mutation or execution retry.
    return reply({ error: "RECOVERY_UNAVAILABLE" }, 503);
  }
});
