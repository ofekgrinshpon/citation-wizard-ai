/**
 * Project association is client-supplied, so it must be authorized before it is
 * stored on a research job.
 *
 * Ownership is established with the *user-scoped* client only: the lookup runs
 * under the caller's RLS, so a project belonging to somebody else simply does
 * not exist for this query. A client-supplied user_id is never trusted, and the
 * service-role client is deliberately not used here.
 *
 * Failure is silent by design: an unowned or unknown project id is dropped
 * (the job is created with no project association) rather than rejected, so the
 * response never reveals whether another user's project exists.
 */

export interface ProjectOwnershipClient {
  from(table: string): {
    // deno-lint-ignore no-explicit-any
    select(cols: string): any;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the project id only when it exists AND belongs to the caller. */
export async function resolveOwnedProjectId(
  userClient: ProjectOwnershipClient,
  rawProjectId: unknown,
): Promise<string | null> {
  if (typeof rawProjectId !== "string" || !UUID_RE.test(rawProjectId)) return null;
  try {
    const { data, error } = await userClient
      .from("projects")
      .select("id")
      .eq("id", rawProjectId)
      .maybeSingle();
    if (error) return null;
    const id = (data as { id?: string } | null)?.id;
    return id === rawProjectId ? rawProjectId : null;
  } catch {
    return null;
  }
}
