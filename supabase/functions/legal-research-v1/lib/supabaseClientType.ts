/**
 * Structural Supabase client type.
 *
 * The edge functions run on Deno and import the client from a remote URL, which
 * the repo-wide TypeScript check cannot resolve. This local, structural type
 * covers everything the pipeline actually uses (`from(...)` query builders and
 * `storage`), so type checking works in both environments without a remote type
 * import.
 */

// deno-lint-ignore no-explicit-any
type Any = any;

export interface SupabaseClientLike {
  from(table: string): Any;
  rpc(fn: string, params?: Record<string, unknown>): Any;
  storage: Any;
  auth: Any;
  functions: Any;
}

export type SupabaseClient = SupabaseClientLike;
