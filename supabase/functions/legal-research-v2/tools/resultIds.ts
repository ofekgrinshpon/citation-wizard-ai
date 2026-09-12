/**
 * legal-research-v2 — one process-wide result-id sequence.
 *
 * Both `search` and `lookup_authority` mint ids from here so that every
 * candidate the agent ever sees is addressable the same way: `fetch({result_id})`.
 * No ranking, no routing — just identifiers.
 */

let counter = 0;

export function nextResultId(): string {
  counter += 1;
  return `R${counter}`;
}

/** Test seam: reset the per-process result-id counter. */
export function resetResultIds(): void {
  counter = 0;
}

/**
 * Durability across worker restarts: a resumed chunk runs in a fresh isolate
 * where the counter is 0 again, so new candidates would re-mint ids that the
 * restored `discovered` map already uses — silently overwriting candidates
 * (and their authority identity). Seeding past the highest known id keeps
 * every id unique for the whole run. Monotonic: never lowers the counter.
 */
export function seedResultIds(existingIds: Iterable<string>): void {
  for (const id of existingIds) {
    const n = /^R(\d+)$/.exec(String(id ?? ""))?.[1];
    if (n) counter = Math.max(counter, Number(n));
  }
}
