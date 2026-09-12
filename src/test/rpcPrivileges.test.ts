/**
 * Security regression: internal / service-only RPCs must never be EXECUTE-able
 * by the PostgREST-facing roles (`anon`, `authenticated`).
 *
 * This queries the LIVE database privileges (has_function_privilege), not SQL
 * source text, so a future blanket `GRANT EXECUTE ... TO authenticated` — the
 * exact regression found in the pre-launch audit — fails this test loudly.
 *
 * The list below is the explicit, auditable set of functions locked down by
 * drizzle/migrations/0000_security_lock_internal_rpcs.sql. Adding a new
 * internal RPC? Add it here and to a lockdown migration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

/** name → identity argument signature (exact overload, as in the migration). */
export const PROTECTED_RPCS: ReadonlyArray<[name: string, args: string]> = [
  ["heartbeat_operation_lock_for_user", "_user_id uuid, _operation_id text"],
  ["release_operation_lock_for_user", "_user_id uuid, _operation_id text, _reason text"],
  ["enqueue_email", "queue_name text, payload jsonb"],
  ["read_email_batch", "queue_name text, batch_size integer, vt integer"],
  ["delete_email", "queue_name text, message_id bigint"],
  ["move_to_dlq", "source_queue text, dlq_name text, message_id bigint, payload jsonb"],
  ["email_queue_dispatch", ""],
  ["rebuild_hnsw_index", ""],
  ["reset_or_renew_credits", ""],
  ["grant_referral_bonus_if_eligible", "_user_id uuid"],
  ["refund_credits_for_user", "_user_id uuid, _request_id text, _reason text"],
  ["bulk_update_legal_chunk_embeddings", "payload jsonb"],
];

const hasDb = !!process.env.PGHOST || !!process.env.SUPABASE_DB_URL;

interface PrivRow {
  proname: string;
  args: string;
  anon_exec: boolean;
  authenticated_exec: boolean;
  service_role_exec: boolean;
}

describe.skipIf(!hasDb)("internal RPC execute privileges", () => {
  let sql: ReturnType<typeof postgres>;
  let rows: PrivRow[] = [];

  beforeAll(async () => {
    sql = process.env.SUPABASE_DB_URL && !process.env.PGHOST
      ? postgres(process.env.SUPABASE_DB_URL, { max: 1 })
      : postgres({ max: 1 });
    rows = (await sql<PrivRow[]>`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    `) as unknown as PrivRow[];
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("finds every protected function in the database", () => {
    const missing = PROTECTED_RPCS.filter(
      ([name, args]) => !rows.some((r) => r.proname === name && r.args === args),
    );
    expect(missing, `protected RPCs not found (renamed/dropped?): ${JSON.stringify(missing)}`)
      .toEqual([]);
  });

  it("never grants EXECUTE on a protected RPC to anon or authenticated", () => {
    const exposed = rows
      .filter((r) => PROTECTED_RPCS.some(([n, a]) => n === r.proname && a === r.args))
      .filter((r) => r.anon_exec || r.authenticated_exec)
      .map((r) => `${r.proname}(${r.args}) anon=${r.anon_exec} authenticated=${r.authenticated_exec}`);
    expect(
      exposed,
      `SECURITY REGRESSION: internal RPCs are executable by public roles:\n${exposed.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps protected RPCs callable by service_role", () => {
    const broken = rows
      .filter((r) => PROTECTED_RPCS.some(([n, a]) => n === r.proname && a === r.args))
      .filter((r) => !r.service_role_exec)
      .map((r) => `${r.proname}(${r.args})`);
    expect(broken, `service_role lost EXECUTE on: ${broken.join(", ")}`).toEqual([]);
  });
});
