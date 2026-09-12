/**
 * Authorization regression: a research job may only be associated with a
 * project the authenticated caller actually owns.
 */
import { describe, it, expect } from "vitest";
import {
  resolveOwnedProjectId,
} from "../../supabase/functions/legal-research-v2/beta/projectOwnership.ts";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** Mimics a user-scoped Supabase client: RLS hides other users' rows. */
function userScopedClient(ownedIds: string[], opts: { error?: boolean } = {}) {
  const calls: Array<{ table: string; id: string }> = [];
  const client = {
    calls,
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, id: string) {
              calls.push({ table, id });
              return {
                maybeSingle() {
                  if (opts.error) return Promise.resolve({ data: null, error: { message: "boom" } });
                  return Promise.resolve({
                    data: ownedIds.includes(id) ? { id } : null,
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  return client;
}

describe("V2 project ownership", () => {
  it("A. accepts a project owned by the caller", async () => {
    const c = userScopedClient([OWN]);
    expect(await resolveOwnedProjectId(c, OWN)).toBe(OWN);
  });

  it("B. drops another user's project id (invisible under caller RLS)", async () => {
    const c = userScopedClient([OWN]);
    expect(await resolveOwnedProjectId(c, OTHER)).toBeNull();
  });

  it("C. drops a nonexistent/random project id", async () => {
    const c = userScopedClient([]);
    expect(await resolveOwnedProjectId(c, crypto.randomUUID())).toBeNull();
  });

  it("D. no project_id → null, and no database lookup at all", async () => {
    const c = userScopedClient([OWN]);
    expect(await resolveOwnedProjectId(c, null)).toBeNull();
    expect(await resolveOwnedProjectId(c, undefined)).toBeNull();
    expect(c.calls).toEqual([]);
  });

  it("E. rejects non-uuid / injection-shaped input without querying", async () => {
    const c = userScopedClient([OWN]);
    for (const bad of ["", "not-a-uuid", "' or 1=1--", 42, {}, [OWN]]) {
      expect(await resolveOwnedProjectId(c, bad as unknown)).toBeNull();
    }
    expect(c.calls).toEqual([]);
  });

  it("F. queries only the projects table, scoped to the supplied id", async () => {
    const c = userScopedClient([OWN]);
    await resolveOwnedProjectId(c, OWN);
    expect(c.calls).toEqual([{ table: "projects", id: OWN }]);
  });

  it("G. fails closed when the ownership lookup errors", async () => {
    const c = userScopedClient([OWN], { error: true });
    expect(await resolveOwnedProjectId(c, OWN)).toBeNull();
  });

  it("H. fails closed when the client throws", async () => {
    const throwing = {
      from() {
        throw new Error("network");
      },
    } as unknown as Parameters<typeof resolveOwnedProjectId>[0];
    expect(await resolveOwnedProjectId(throwing, OWN)).toBeNull();
  });

  it("I. never echoes back an id the database did not confirm", async () => {
    const mismatched = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: OTHER }, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof resolveOwnedProjectId>[0];
    expect(await resolveOwnedProjectId(mismatched, OWN)).toBeNull();
  });
});
