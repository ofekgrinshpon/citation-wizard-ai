import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const name = "20261013100000_citation_request_refund_guards.sql";
const sql = readFileSync(resolve(root, "supabase/migration-drafts", name), "utf8");
function body(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Missing draft function: ${name}`);
  const finish = sql.indexOf("\n$$;", start);
  if (finish < 0) throw new Error(`Missing function delimiter: ${name}`);
  return sql.slice(start, finish);
}
const begin = body("begin_citation_request");
const finish = body("finish_citation_request");
const refund = body("refund_credits_for_user");
const attest = body("attest_usage_failure");
const receipt = body("_citation_refund_receipt");

// These are source-contract checks only, not PostgreSQL parsing or execution.
describe("usage SQL review draft (static checks, no database)", () => {
  it("remains outside auto-applied migrations with explicit no-execution notice", () => {
    expect(existsSync(resolve(root, "supabase/migrations", name))).toBe(false);
    expect(sql).toContain("DO NOT EXECUTE, including synthetic fixtures");
  });
  it("binds service-owned request identities and fingerprint", () => {
    expect(sql).toContain("PRIMARY KEY (user_id, request_id)");
    expect(begin).toContain("prior.fingerprint <> _fingerprint OR prior.batch_id IS DISTINCT FROM _batch_id");
    expect(begin).toContain("REQUEST_FINGERPRINT_MISMATCH");
    expect(sql).toContain("REVOKE ALL ON public.citation_usage_requests, public.usage_terminal_failures FROM PUBLIC, anon, authenticated");
  });
  it("checks caller service identity inside every mutating API", () => {
    for (const fn of [begin, finish, refund, attest, receipt]) expect(fn).toContain("PERFORM public._require_usage_service();");
    const guard = body("_require_usage_service");
    expect(guard).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(guard).toContain("current_setting('role', true)");
    expect(guard).not.toMatch(/IF[^;]*current_user/);
  });
  it("locks profile before request lookup and keeps claim plus ledger insertion atomic", () => {
    const profileLock = begin.indexOf("SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE");
    const replayLookup = begin.indexOf("SELECT * INTO prior FROM public.citation_usage_requests");
    expect(profileLock).toBeGreaterThan(0);
    expect(profileLock).toBeLessThan(replayLookup);
    expect(begin.indexOf("INSERT INTO public.citation_usage_requests")).toBeLessThan(begin.indexOf("INSERT INTO public.credit_ledger"));
    expect(begin).not.toContain("EXCEPTION WHEN");
  });
  it("returns duplicate status without an attempt token and never restarts aged claims", () => {
    const duplicates = [...begin.matchAll(/RETURN jsonb_build_object\('ok', true, 'execute', false,[\s\S]*?\);/g)];
    expect(duplicates).toHaveLength(2);
    for (const [duplicate] of duplicates) {
      expect(duplicate).toContain("'request_id', prior.request_id");
      expect(duplicate).not.toContain("'attempt_token'");
      expect(duplicate).not.toMatch(/UPDATE|INSERT|created_at\s*[<>]|interval/);
    }
  });
  it("rejects legacy consume IDs instead of using replay as execution permission", () => {
    expect(begin).toContain("IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _user_id AND request_id = _request_id)");
    expect(begin).toContain("REQUEST_ID_ALREADY_USED");
  });
  it("enforces expiry before free follower eligibility bypass", () => {
    expect(begin.indexOf("IF NOT is_admin AND expired THEN")).toBeLessThan(begin.indexOf("ELSIF is_admin OR amount = 0 THEN"));
    expect(begin).toContain("'INSUFFICIENT_CREDITS'");
    expect(begin).toContain("win_avail >= amount AND period_avail >= amount");
  });
  it("fixes batch size at five and excludes old user-created batch metadata", () => {
    expect(begin).not.toContain("_group_size");
    expect(begin).toContain("member.batch_anchor_request_id = a.request_id) < 5");
    expect(begin).toContain("a.state <> 'failed'");
    expect(begin).toContain("paid_anchor.amount < 0");
    expect(begin).not.toContain("metadata->>'batch_id'");
  });
  it("never lets owner reason mint a new refund", () => {
    const owner = body("refund_credits");
    expect(owner).toContain("TRUSTED_FAILURE_REQUIRED");
    expect(owner).not.toMatch(/INSERT|UPDATE|refund_credits_for_user\(/);
  });
  it("requires token ownership and keeps all terminal states immutable", () => {
    expect(finish).toContain("request.attempt_token <> _attempt_token");
    expect(finish).toContain("IF request.state <> 'in_progress'");
    expect(finish).toContain("TERMINAL_STATE_CONFLICT");
    expect(finish).toContain("IF _outcome = 'failed' THEN");
  });
  it("requires trusted service failure and refuses citation legacy bypass", () => {
    expect(refund).toContain("request.state <> 'failed'");
    expect(refund).toContain("SELECT * INTO failure FROM public.usage_terminal_failures");
    expect(attest).toContain("CITATION_ATTEMPT_REQUIRED");
    expect(attest).toContain("consumed.reason = 'citation-chat'");
    for (const fn of [attest, refund]) {
      expect(fn).toContain("job.result->>'execution_outcome_unknown' IS DISTINCT FROM 'false'");
      expect(fn).toContain("job.result->>'delivery_failed' = 'true')) IS NOT TRUE");
    }
  });
  it("defers anchor refunds while any sibling succeeded, is active, or is unknown", () => {
    expect(refund).toContain("sibling.state <> 'failed'");
    expect(refund).toContain("'refunded', false, 'deferred', true");
    expect(finish).toContain("'all batch members failed'");
    expect(finish).toContain("a.state = 'failed'");
  });
  it("restores original bucket deltas once and keeps old refunds out of new windows", () => {
    expect(refund).toContain("included_credits_remaining - consumed.included_delta");
    expect(refund).toContain("topup_credits_remaining - consumed.topup_delta");
    expect(refund).toContain("legacy_bonus_remaining - consumed.legacy_delta");
    expect(refund).toContain("prof.window_started_at = (consumed.metadata->>'window_started_at')::timestamptz");
    expect(refund.indexOf("event_type = 'refund'")).toBeLessThan(refund.indexOf("UPDATE public.profiles"));
    expect(refund).toContain("'refunded', false, 'noop', true");
  });
  it("binds and rechecks original included-credit plan/period before restoration", () => {
    expect(begin).toContain("'billing_period_started_at', prof.billing_period_started_at");
    expect(refund).toContain("consumed.metadata->>'plan' IS DISTINCT FROM prof.plan");
    expect(refund).toContain("consumed.created_at < prof.billing_period_started_at");
    expect(refund).toContain("ORIGINAL_ALLOWANCE_UNAVAILABLE");
    expect(refund.indexOf("ORIGINAL_ALLOWANCE_UNAVAILABLE")).toBeLessThan(refund.indexOf("UPDATE public.profiles"));
  });
  it("marks reaper timeouts unknown, without returning credits or promising them", () => {
    const start = sql.indexOf("DROP FUNCTION IF EXISTS public.reap_stale_research_jobs(interval, interval)");
    const reaper = sql.slice(start);
    expect(start).toBeGreaterThan(0);
    expect(reaper).toContain("'credits_refunded', false");
    expect(reaper).toContain("'execution_outcome_unknown', true");
    expect(reaper).not.toContain("public.refund_credits_for_user(");
    expect(reaper).not.toContain("הקרדיטים על ההרצה הזו הוחזרו");
    expect(reaper).not.toContain("CASCADE");
  });
  it("preserves the installed resume-aware absolute timeout instead of using original creation age", () => {
    const reaper = body("reap_stale_research_jobs");
    expect(reaper).toContain("OR COALESCE(resumed_at, created_at) < now() - _absolute_max_age");
    expect(reaper).not.toContain("OR created_at < now() - _absolute_max_age");
  });
  it("retains inactivity, startup grace and eligible-status guards beside the resume-aware timeout", () => {
    const reaper = body("reap_stale_research_jobs");
    expect(reaper).toContain("status IN ('running','queued')");
    expect(reaper).toContain("created_at < now() - LEAST(_max_age, interval '2 minutes')");
    expect(reaper).toContain("COALESCE(last_progress_at, updated_at) < now() - _max_age");
    expect(reaper).toContain("AND updated_at < now() - _max_age");
    expect(reaper).toContain("FOR UPDATE SKIP LOCKED");
  });
  it("stores a same-user, non-self successor with one canonical child per parent", () => {
    expect(sql).toContain("UNIQUE (user_id, retry_of_request_id)");
    expect(sql).toContain("FOREIGN KEY (user_id, retry_of_request_id)");
    expect(sql).toContain("CHECK (retry_of_request_id IS NULL OR retry_of_request_id <> request_id)");
    expect(begin).toContain("_retry_of_request_id text DEFAULT NULL");
  });
  it("validates parent identity, failure and content before existing-ID replay", () => {
    const lookup = begin.indexOf("SELECT * INTO parent_request");
    const requestedLookup = begin.indexOf("SELECT * INTO prior FROM public.citation_usage_requests");
    expect(lookup).toBeLessThan(requestedLookup);
    expect(begin).toContain("WHERE user_id = _user_id AND request_id = _retry_of_request_id FOR UPDATE");
    expect(begin).toContain("parent_request.state <> 'failed'");
    expect(begin).toContain("parent_request.fingerprint <> _fingerprint OR parent_request.batch_id IS DISTINCT FROM _batch_id");
    for (const code of ["INVALID_RETRY_REQUEST", "RETRY_PARENT_NOT_FOUND", "RETRY_PARENT_NOT_FAILED", "RETRY_FINGERPRINT_MISMATCH"]) expect(begin).toContain(code);
  });
  it("rejects ancestry mismatch even for a requested ID that already exists", () => {
    expect(begin).toContain("prior.retry_of_request_id IS DISTINCT FROM _retry_of_request_id");
    expect(begin.indexOf("REQUEST_ANCESTRY_MISMATCH")).toBeLessThan(begin.indexOf("'replayed', true"));
  });
  it("returns the immediate canonical child instead of advancing retry ancestry", () => {
    expect(begin).toContain("WHERE user_id = _user_id AND retry_of_request_id = _retry_of_request_id FOR UPDATE");
    const canonical = begin.slice(begin.indexOf("WHERE user_id = _user_id AND retry_of_request_id = _retry_of_request_id FOR UPDATE"), begin.indexOf("IF EXISTS (SELECT 1 FROM public.credit_ledger"));
    expect(canonical).toContain("'execute', false");
    expect(canonical).toContain("'request_id', prior.request_id");
    expect(canonical).not.toMatch(/LOOP|WITH RECURSIVE|INSERT|attempt_token/);
  });
  it("creates no successor until quota passes and atomically binds its parent", () => {
    const reject = begin.indexOf("IF block IS NOT NULL THEN");
    const claim = begin.indexOf("INSERT INTO public.citation_usage_requests");
    expect(reject).toBeLessThan(claim);
    expect(begin).toContain("VALUES (_user_id, _request_id, _fingerprint, _batch_id, _retry_of_request_id,");
    expect(begin.indexOf("SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE")).toBeLessThan(begin.indexOf("SELECT * INTO parent_request"));
  });
  it("confirms refunds using only positive ledger receipts, never failure alone", () => {
    expect(receipt).toContain("event_type = 'refund' AND amount > 0");
    expect(receipt).toContain("'units_refunded', refunded_row.amount");
    expect(receipt).toContain("'status', 'refunded', 'refunded', true");
    expect(receipt.match(/'refunded', true/g)).toHaveLength(1);
    expect(receipt).not.toMatch(/INSERT INTO|UPDATE public\./);
  });
  it("distinguishes retained, deferred, review and never-charged group outcomes", () => {
    for (const status of ["retained", "deferred", "review_required", "not_charged", "not_applicable", "unconfirmed"]) expect(receipt).toContain(`'${status}'`);
    expect(receipt).toContain("COALESCE(request.batch_anchor_request_id, request.request_id)");
    expect(receipt).toContain("sibling.state IN ('succeeded', 'unknown')");
    expect(receipt).toContain("sibling.state = 'in_progress'");
  });
  it("returns authoritative receipts on fresh and replayed failure plus parent receipt on retry", () => {
    expect(finish.match(/'refund_receipt', receipt/g)).toHaveLength(2);
    expect(begin.match(/'refund_receipt', receipt/g)).toHaveLength(2);
    expect(begin.match(/'retry_parent_refund_receipt', parent_receipt/g)).toHaveLength(3);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._citation_refund_receipt(uuid, text) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("public.begin_citation_request(uuid, text, text, text, text, jsonb)");
  });

});

describe("durable recovery SQL draft (source inspection only, NOT SQL execution)", () => {
  const read = body("read_citation_recovery"), cleanup = body("cleanup_citation_recovery");
  it("stores recovery in a service-only side table with no user policy", () => {
    expect(sql).toContain("CREATE TABLE public.citation_recovery_payloads");
    expect(sql).toContain("ALTER TABLE public.citation_recovery_payloads ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.citation_recovery_payloads FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*citation_recovery_payloads/);
  });
  it("checks bounded closed-schema execution input and matching fingerprint before any claim", () => {
    expect(begin).toContain("public._citation_recovery_valid(_recovery_input, 'input')");
    expect(begin).toContain("(_recovery_input->>'batchId') IS DISTINCT FROM _batch_id");
    expect(begin).toContain("public._citation_execution_fingerprint(_recovery_input) IS DISTINCT FROM _fingerprint");
    expect(begin.indexOf("INVALID_RECOVERY_INPUT")).toBeLessThan(begin.indexOf("INSERT INTO public.citation_usage_requests"));
    expect(body("_citation_recovery_valid")).toContain("max_bytes := 131072");
    expect(body("_citation_recovery_valid")).toContain("max_bytes := 262144");
    expect(body("_citation_json_shape")).toContain("NOT (_schema->'properties' ? item.key)");
  });
  it("atomically stores input with fixed claim-relative expiry before the debit", () => {
    expect(begin.indexOf("INSERT INTO public.citation_usage_requests")).toBeLessThan(begin.indexOf("INSERT INTO public.citation_recovery_payloads"));
    expect(begin.indexOf("INSERT INTO public.citation_recovery_payloads")).toBeLessThan(begin.indexOf("UPDATE public.profiles"));
    expect(begin).toContain("created_at + interval '24 hours'");
    expect(begin).not.toContain("EXCEPTION WHEN");
  });
  it("requires valid result and owning token then stores result before successful state under locks", () => {
    expect(finish).toContain("public._citation_recovery_valid(_result, 'result')");
    expect(finish.indexOf("ATTEMPT_TOKEN_MISMATCH")).toBeLessThan(finish.indexOf("UPDATE public.citation_recovery_payloads"));
    expect(finish).toContain("request.result_fingerprint IS DISTINCT FROM result_hash");
    expect(finish).toContain("RESULT_CONFLICT");
    expect(finish).toContain("AND result IS NULL");
    expect(finish.indexOf("UPDATE public.citation_recovery_payloads")).toBeLessThan(finish.indexOf("UPDATE public.citation_usage_requests"));
    expect(finish).toContain("recovery.expires_at <= clock_timestamp()");
    expect(finish).not.toContain("EXCEPTION WHEN");
  });
  it("keeps immutable result hash after cleanup and refuses empty success", () => {
    expect(sql).toContain("CHECK ((state = 'succeeded') = (result_fingerprint IS NOT NULL))");
    expect(body("_citation_recovery_valid")).toContain("COALESCE(jsonb_typeof(_value->'foreignLookup') = 'object', false)");
    expect(finish).toContain("'result_stored', _outcome = 'succeeded'");
  });
  it("reads one owner's immediate canonical child without recursive retry or mutations", () => {
    expect(read).toContain("WHERE c.user_id = _user_id");
    expect(read).toContain("c.retry_of_request_id = _parent_request_id");
    expect(read).not.toMatch(/WITH RECURSIVE|INSERT INTO|UPDATE public\.|DELETE FROM|begin_citation_request|finish_citation_request|refund_credits_for_user/);
    expect(read).toContain("public._citation_refund_receipt(_user_id, entry.request_id)");
  });
  it("hides content at the cutoff independent of cleanup, and verifies payload binding", () => {
    expect(read).toContain("expires := entry.created_at + interval '24 hours'");
    expect(read).toContain("IF expires <= current_ts THEN");
    expect(read).toContain("input_body := NULL;");
    expect(read).toContain("entry.payload_expires_at IS DISTINCT FROM expires");
    expect(read).toContain("public._citation_execution_fingerprint(entry.recovery_input) IS DISTINCT FROM entry.fingerprint");
    expect(read).toContain("IF availability = 'unavailable' THEN input_body := NULL; result_body := NULL; END IF");
  });
  it("has owner-scoped stable pagination and byte limits", () => {
    expect(read).toContain("WHERE user_id = _user_id AND request_id = _cursor");
    expect(read).toContain("(c.created_at, c.request_id) < (cursor_row.created_at, cursor_row.request_id)");
    expect(read).toContain("ORDER BY c.created_at DESC, c.request_id DESC LIMIT _limit + 1");
    expect(read).toContain("1572864");
    expect(read).toContain("_limit NOT BETWEEN 1 AND 50");
  });
  it("cleans only expired payloads, never claims, ledgers or saved history", () => {
    expect(cleanup).toContain("DELETE FROM public.citation_recovery_payloads");
    expect(cleanup).toContain("expires_at <= clock_timestamp()");
    expect(cleanup).toContain("FOR UPDATE SKIP LOCKED");
    expect(cleanup).not.toMatch(/citation_history|credit_ledger|citation_usage_requests|usage_terminal_failures|UPDATE public\./);
    expect(cleanup).toContain("PERFORM public._require_usage_service()");
    expect(read).toContain("PERFORM public._require_usage_service()");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.read_citation_recovery(uuid,text,text,text,integer) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.cleanup_citation_recovery(integer) FROM PUBLIC, anon, authenticated");
  });
  it("drafts cleanup without registering a scheduler or enabling a gateway override", () => {
    const notes = readFileSync(resolve(root, "supabase/migration-drafts/README.citation-recovery-cleanup-scheduling.md"), "utf8");
    expect(notes).toContain("Nothing here is installed, run, or scheduled");
    expect(sql).not.toMatch(/cron\.schedule|CREATE EXTENSION/);
    const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
    expect(config).not.toContain("[functions.citation-recovery]");
  });
});


it("keeps authored closed input/result schemas aligned with the public payload keys", () => {
  const schemas = [...body("_citation_recovery_valid").matchAll(/\$schema\$([\s\S]*?)\$schema\$/g)].map((match) => JSON.parse(match[1]));
  expect(schemas).toHaveLength(2);
  expect(Object.keys(schemas[0].properties).sort()).toEqual(["batchId", "foreignLookup", "messages", "rawInput"]);
  expect(schemas[0].properties.messages.maxItems).toBe(100);
  expect(schemas[0].properties.messages.items.properties.role.enum).toEqual(["system", "user", "assistant"]);
  expect(Object.keys(schemas[1].properties).sort()).toEqual(["content", "foreignLookup"]);
  expect(schemas[1].properties.foreignLookup.required).toContain("identity");
  expect(body("_citation_canonical_json")).toContain('ORDER BY e.key COLLATE "C"');
  expect(body("_citation_canonical_json")).toContain("ORDER BY e.ordinality");
});
