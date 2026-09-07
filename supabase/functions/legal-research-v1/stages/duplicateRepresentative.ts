// authority_duplicate_resolution_v1
//
// Deduplication keeps exactly ONE record per legal authority/document. Until
// now the survivor was simply whichever duplicate happened to be walked first,
// so a thin, snippet-only record could eliminate a materially more usable
// representation of the SAME authority (concrete fetchable URL, confirmed
// docket identity, acquired body).
//
// This module resolves *within* a duplicate group only. It never compares or
// re-ranks different authorities: the set of pool positions occupied by a
// group is preserved exactly, only the order of the group's own members inside
// those positions changes. No global preference for judgments, statutes or
// scholarship is introduced — every signal used is representation quality.
//
// Pure module: no network, no model calls.

export interface DuplicateSignals {
  /** Duplicate-group keys this record carries (document id, url, docket, ...). */
  keys: string[];
  /** Concrete, directly fetchable http(s) document URL. */
  fetchable_url: boolean;
  /** Any concrete URL at all. */
  has_url: boolean;
  /** Docket / authority identity confirmed for this record. */
  exact_identity: boolean;
  /** Source-integrity says this record can carry its role. */
  integrity_usable: boolean;
  /** A body was already acquired for this record. */
  has_body: boolean;
  body_chars: number;
  snippet_chars: number;
  /** Index/listing/search page — never a good representative. */
  listing_like: boolean;
}

export interface DuplicateGroupRow {
  group_key: string;
  members: Array<{
    candidate_id: string;
    title: string;
    url: string | null;
    usability: number;
    order_index: number;
    selected: boolean;
    reason: string;
  }>;
  selected_candidate_id: string;
  selected_reason: string;
}

/**
 * Representation-quality score. Deterministic, bounded, derived only from
 * existing signals. Identical for every source role.
 */
export function usabilityScore(s: DuplicateSignals): number {
  let v = 0;
  if (s.listing_like) v -= 4;
  if (s.has_body) v += 4;
  if (s.exact_identity) v += 3;
  if (s.fetchable_url) v += 2;
  else if (s.has_url) v += 1;
  if (s.integrity_usable) v += 1;
  v += Math.min(2, Math.max(0, s.body_chars) / 20000);
  v += Math.min(1, Math.max(0, s.snippet_chars) / 1200);
  return Number(v.toFixed(4));
}

export function usabilityReason(s: DuplicateSignals): string {
  const parts: string[] = [];
  if (s.has_body) parts.push(`body:${s.body_chars}`);
  if (s.exact_identity) parts.push("exact_identity");
  if (s.fetchable_url) parts.push("fetchable_url");
  else if (s.has_url) parts.push("url");
  if (s.integrity_usable) parts.push("integrity_usable");
  if (s.listing_like) parts.push("listing_like");
  if (!parts.length) parts.push(`snippet:${s.snippet_chars}`);
  return parts.join("+");
}

interface Minimal {
  candidate_id: string;
  title: string;
  source_url?: string | null;
}

/**
 * Reorder duplicates so that the strongest representation of each authority is
 * the one the existing first-come-wins dedupe keeps. Positions occupied by a
 * duplicate group are unchanged, so ranking between different authorities is
 * untouched.
 */
export function resolveDuplicateRepresentatives<T extends Minimal>(
  ordered: T[],
  signalsOf: (c: T) => DuplicateSignals,
): { order: T[]; groups: DuplicateGroupRow[]; reordered: number } {
  const sig = new Map<string, DuplicateSignals>();
  const score = new Map<string, number>();
  ordered.forEach((c) => {
    const s = signalsOf(c);
    sig.set(c.candidate_id, s);
    score.set(c.candidate_id, usabilityScore(s));
  });

  // Union-find over shared duplicate keys.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of ordered) parent.set(c.candidate_id, c.candidate_id);
  const keyOwner = new Map<string, string>();
  for (const c of ordered) {
    for (const k of sig.get(c.candidate_id)!.keys) {
      if (!k) continue;
      const prev = keyOwner.get(k);
      if (prev) union(prev, c.candidate_id);
      else keyOwner.set(k, c.candidate_id);
    }
  }

  const groups = new Map<string, number[]>(); // root → positions
  ordered.forEach((c, i) => {
    const r = find(c.candidate_id);
    const arr = groups.get(r) ?? [];
    arr.push(i);
    groups.set(r, arr);
  });

  const order = [...ordered];
  const rows: DuplicateGroupRow[] = [];
  let reordered = 0;

  for (const [root, positions] of groups) {
    if (positions.length < 2) continue;
    const members = positions.map((p) => ordered[p]);
    let best = members[0];
    let bestIdx = 0;
    members.forEach((m, i) => {
      const s = score.get(m.candidate_id)!;
      if (s > score.get(best.candidate_id)! + 1e-9) {
        best = m;
        bestIdx = i;
      }
    });
    const rest = members.filter((m) => m.candidate_id !== best.candidate_id);
    const newOrder = [best, ...rest];
    positions.forEach((p, i) => {
      order[p] = newOrder[i];
    });
    if (bestIdx !== 0) reordered++;
    rows.push({
      group_key: root,
      selected_candidate_id: best.candidate_id,
      selected_reason: usabilityReason(sig.get(best.candidate_id)!),
      members: members.map((m, i) => ({
        candidate_id: m.candidate_id,
        title: m.title,
        url: m.source_url ?? null,
        usability: score.get(m.candidate_id)!,
        order_index: positions[i],
        selected: m.candidate_id === best.candidate_id,
        reason: usabilityReason(sig.get(m.candidate_id)!),
      })),
    });
  }

  return { order, groups: rows, reordered };
}
