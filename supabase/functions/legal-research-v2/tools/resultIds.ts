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
