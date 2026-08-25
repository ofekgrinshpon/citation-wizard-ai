// verified_legal_sources cache — persistent store of legal sources that were
// actually acquired *and* identity-validated in an earlier run.
//
// A cache hit removes a web search, up to four fetches and — crucially — one
// extraction slot, the scarce resource that has been killing runs. A hit is
// never a shortcut past a gate: the injected candidate goes through source
// integrity, verifier, claim-source-match, sufficiency and the footnote
// invariant exactly like a freshly retrieved row.
//
// Never cached as a body: block/WAF pages, listing pages, metadata-only pages,
// identity mismatches. Those are recorded as negative rows with a cooldown so
// the pipeline stops re-probing a dead endpoint every run — never permanently
// suppressed, never citable.

// deno-lint-ignore no-explicit-any
type Admin = any;

export const VERIFIED_SOURCE_CACHE_VERSION = "verified_source_cache_v2";

/**
 * Discovery strategies are cooldown-scoped: a failure recorded by one strategy
 * must never suppress a *different* (usually newer, better) strategy for the
 * same identifier. Legacy rows carry `unknown`/`v0` and therefore match no
 * current strategy — old derivation failures cannot block search-first.
 */
export type DiscoveryStrategy =
  | "derived_court_url"
  | "retrieved_official_url"
  | "search_first_judgment"
  | "statute_official_url"
  | "unknown";


export const CACHE_LIMITS = {
  MAX_TEXT: 400_000,
  CHUNK_CHARS: 12_000,
  MAX_CHUNKS: 34,
  MIN_BODY_CHARS: 600,
  /** Cooldown after a failure, doubling per failure up to the ceiling. */
  COOLDOWN_BASE_DAYS: 7,
  COOLDOWN_MAX_DAYS: 60,
  /** Staleness windows. */
  STALE_DAYS_JUDGMENT: 180,
  STALE_DAYS_STATUTE: 30,
} as const;

export type CacheCategory =
  | "judgment"
  | "statute"
  | "regulation"
  | "report"
  | "scholarship"
  | "other";

export type CacheStatus =
  | "verified"
  | "stale"
  | "blocked"
  | "failed"
  | "identity_mismatch"
  | "bibliographic_mismatch";

export interface CacheLookupKey {
  category: CacheCategory;
  normalized_docket?: string | null;
  statute_title?: string | null;
  statute_section?: string | null;
  canonical_title?: string | null;
  authors?: string[];
  institution?: string | null;
  year?: number | null;
  /** Cooldown scope. Omit to fall back to the legacy (any-strategy) behaviour. */
  strategy?: DiscoveryStrategy | null;
  discovery_version?: string | null;
}


export interface CachedSource {
  id: string;
  source_category: string;
  source_type: string;
  normalized_docket: string | null;
  canonical_title: string | null;
  statute_title: string | null;
  statute_section: string | null;
  official_url: string | null;
  source_host: string | null;
  court: string | null;
  institution: string | null;
  year: number | null;
  language: string | null;
  is_translation: boolean;
  body_chars: number;
  identity_validated: boolean;
  bibliographic_validated: boolean;
  /** identity_hardening_and_cache_purge_v1 */
  identity_validation_version: string | null;
  identity_evidence_type: string[] | null;
  identity_evidence_summary: string | null;
  identity_confidence: string | null;
  validated_docket: string | null;
  validated_title: string | null;
  validation_source: string | null;
  identity_terms_matched: string[] | null;
  status: string;
  verified_at: string | null;
  failure_count: number;
  last_failure_reason: string | null;
  text: string;
}

export interface CacheLookupResult {
  hit: boolean;
  source: CachedSource | null;
  status: CacheStatus | null;
  /** True when a negative row is still inside its cooldown window. */
  cooldown_active: boolean;
  cooldown_until: string | null;
  stale: boolean;
  reason: string;
  /** Strategy the suppressing negative row belongs to, when any. */
  cooldown_strategy: string | null;
  /** True when the cooldown decision was scoped to the requested strategy. */
  cooldown_strategy_scoped: boolean;
  /** Negative rows that existed but belonged to another strategy/version. */
  ignored_other_strategy_failures: number;
  ms: number;
}


export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function cooldownDays(failureCount: number): number {
  const d = CACHE_LIMITS.COOLDOWN_BASE_DAYS * Math.pow(2, Math.max(0, failureCount - 1));
  return Math.min(d, CACHE_LIMITS.COOLDOWN_MAX_DAYS);
}

function staleDays(category: string): number {
  return category === "statute" || category === "regulation" || category === "regulator_guidance"
    ? CACHE_LIMITS.STALE_DAYS_STATUTE
    : CACHE_LIMITS.STALE_DAYS_JUDGMENT;
}

function chunkText(text: string): string[] {
  const clipped = text.slice(0, CACHE_LIMITS.MAX_TEXT);
  const chunks: string[] = [];
  for (let i = 0; i < clipped.length; i += CACHE_LIMITS.CHUNK_CHARS) {
    chunks.push(clipped.slice(i, i + CACHE_LIMITS.CHUNK_CHARS));
    if (chunks.length >= CACHE_LIMITS.MAX_CHUNKS) break;
  }
  return chunks;
}

const SELECT_COLS =
  "id,source_category,source_type,normalized_docket,canonical_title,statute_title,statute_section," +
  "official_url,source_host,court,institution,year,language,is_translation,body_chars," +
  "identity_validated,bibliographic_validated,status,verified_at,updated_at,failure_count,last_failure_reason," +
  "discovery_strategy,discovery_version," +
  "identity_validation_version,identity_evidence_type,identity_evidence_summary,identity_confidence," +
  "validated_docket,validated_title,validation_source,identity_terms_matched";

/**
 * Identifier-keyed lookup. Nominations with only a topic query have nothing
 * stable to key on and must not reach this function.
 *
 * A verified row always wins, regardless of which strategy produced it.
 * A negative row only suppresses the *same* strategy at the *same* discovery
 * version — otherwise it is counted and ignored.
 */
export async function lookupVerifiedSource(
  admin: Admin,
  key: CacheLookupKey,
): Promise<CacheLookupResult> {
  const t0 = Date.now();
  const miss = (reason: string, ignored = 0): CacheLookupResult => ({
    hit: false,
    source: null,
    status: null,
    cooldown_active: false,
    cooldown_until: null,
    stale: false,
    reason,
    cooldown_strategy: null,
    cooldown_strategy_scoped: !!key.strategy,
    ignored_other_strategy_failures: ignored,
    ms: Date.now() - t0,
  });

  try {
    let q = admin.from("verified_legal_sources").select(SELECT_COLS)
      .eq("source_category", key.category);
    if (key.normalized_docket) {
      q = q.eq("normalized_docket", key.normalized_docket);
    } else if (key.statute_title && key.statute_section) {
      q = q.eq("statute_title", key.statute_title).eq("statute_section", key.statute_section);
    } else if (key.statute_title) {
      // Statute nominated without a specific section: the whole-statute body
      // is a valid hit. Scope stays statute-only.
      q = q.eq("statute_title", key.statute_title);

    } else if (key.canonical_title) {
      q = q.ilike("canonical_title", `%${key.canonical_title.slice(0, 60)}%`);
    } else {
      return miss("no_lookup_key");
    }
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(6);
    if (error) return miss(`lookup_error:${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return miss("not_cached");

    const verified = rows.find((r) =>
      (r.status === "verified" || r.status === "stale") && r.identity_validated === true
    );
    if (!verified) {
      const negatives = rows;
      const sameStrategy = key.strategy
        ? negatives.filter((r) =>
          String(r.discovery_strategy ?? "unknown") === key.strategy &&
          String(r.discovery_version ?? "v0") === (key.discovery_version ?? "v0")
        )
        : negatives;
      const ignored = negatives.length - sameStrategy.length;
      if (sameStrategy.length === 0) {
        return miss("negative_other_strategy_only", ignored);
      }
      const negative = sameStrategy[0];
      const failures = Number(negative.failure_count ?? 1);
      const updated = new Date(String(negative.updated_at ?? new Date().toISOString()));
      const days = cooldownDays(failures);
      const until = new Date(updated.getTime() + days * 86_400_000);
      const active = until.getTime() > Date.now();
      return {
        hit: false,
        source: null,
        status: String(negative.status) as CacheStatus,
        cooldown_active: active,
        cooldown_until: until.toISOString(),
        stale: false,
        reason: active ? "negative_cooldown_active" : "negative_cooldown_expired",
        cooldown_strategy: String(negative.discovery_strategy ?? "unknown"),
        cooldown_strategy_scoped: !!key.strategy,
        ignored_other_strategy_failures: ignored,
        ms: Date.now() - t0,
      };
    }

    const { data: textRows, error: textErr } = await admin
      .from("verified_legal_source_texts")
      .select("chunk_index,text")
      .eq("source_id", verified.id)
      .order("chunk_index", { ascending: true });
    if (textErr) return miss(`text_lookup_error:${textErr.message}`);
    const text = ((textRows ?? []) as Array<{ text: string }>).map((r) => r.text).join("");
    if (text.length < CACHE_LIMITS.MIN_BODY_CHARS) return miss("cached_body_too_short");

    const verifiedAt = verified.verified_at ? new Date(String(verified.verified_at)) : null;
    const stale = verifiedAt
      ? daysBetween(new Date(), verifiedAt) > staleDays(String(verified.source_category))
      : true;

    // Touch last_used_at (fire and forget — never blocks the run).
    admin.from("verified_legal_sources")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", verified.id)
      .then(() => {}, () => {});

    return {
      hit: true,
      source: { ...(verified as unknown as CachedSource), text },
      status: (stale ? "stale" : "verified") as CacheStatus,
      cooldown_active: false,
      cooldown_until: null,
      stale,
      reason: "cache_hit",
      cooldown_strategy: null,
      cooldown_strategy_scoped: !!key.strategy,
      ignored_other_strategy_failures: 0,
      ms: Date.now() - t0,
    };

  } catch (e) {
    return miss(`lookup_threw:${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface RecordSuccessInput {
  category: CacheCategory;
  source_type: string;
  authority_type?: string | null;
  normalized_docket?: string | null;
  case_prefix?: string | null;
  canonical_title?: string | null;
  party_names?: string[];
  statute_title?: string | null;
  statute_section?: string | null;
  authors?: string[];
  journal_or_publisher?: string | null;
  court?: string | null;
  institution?: string | null;
  year?: number | null;
  official_url: string;
  language?: string | null;
  is_translation?: boolean;
  identity_terms_matched?: string[];
  identity_validated: boolean;
  /** identity_hardening_and_cache_purge_v1 — evidence provenance. */
  identity_validation_version?: string | null;
  identity_evidence_type?: string[];
  identity_evidence_summary?: string | null;
  identity_confidence?: string | null;
  validated_docket?: string | null;
  validated_title?: string | null;
  validation_source?: string | null;
  bibliographic_validated?: boolean;
  acquisition_method: string;
  strategy?: DiscoveryStrategy | null;
  discovery_version?: string | null;
  text: string;

}

export async function recordVerifiedSource(
  admin: Admin,
  input: RecordSuccessInput,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  // Never cache an unvalidated or too-short body.
  if (!input.identity_validated) return { ok: false, id: null, error: "identity_not_validated" };
  const text = input.text.slice(0, CACHE_LIMITS.MAX_TEXT);
  if (text.length < CACHE_LIMITS.MIN_BODY_CHARS) {
    return { ok: false, id: null, error: "body_too_short" };
  }
  try {
    const hash = await sha256Hex(text);
    const now = new Date().toISOString();
    let host: string | null = null;
    try {
      host = new URL(input.official_url).hostname;
    } catch { /* ignore */ }

    const { data, error } = await admin
      .from("verified_legal_sources")
      .upsert({
        source_category: input.category,
        source_type: input.source_type,
        authority_type: input.authority_type ?? null,
        normalized_docket: input.normalized_docket ?? null,
        case_prefix: input.case_prefix ?? null,
        canonical_title: input.canonical_title ?? null,
        party_names: input.party_names ?? [],
        statute_title: input.statute_title ?? null,
        statute_section: input.statute_section ?? null,
        authors: input.authors ?? [],
        journal_or_publisher: input.journal_or_publisher ?? null,
        court: input.court ?? null,
        institution: input.institution ?? null,
        year: input.year ?? null,
        official_url: input.official_url,
        source_host: host,
        source_kind: "official",
        language: input.language ?? "he",
        is_translation: input.is_translation ?? false,
        body_text_hash: hash,
        body_chars: text.length,
        identity_terms_matched: input.identity_terms_matched ?? [],
        identity_validated: true,
        identity_validation_version: input.identity_validation_version ?? null,
        identity_evidence_type: input.identity_evidence_type ?? [],
        identity_evidence_summary: input.identity_evidence_summary ?? null,
        identity_confidence: input.identity_confidence ?? null,
        validated_docket: input.validated_docket ?? null,
        validated_title: input.validated_title ?? null,
        validation_source: input.validation_source ?? null,
        invalidated_reason: null,
        bibliographic_validated: input.bibliographic_validated ?? false,
        acquisition_method: input.acquisition_method,
        discovery_strategy: input.strategy ?? "unknown",
        discovery_version: input.discovery_version ?? "v0",
        status: "verified",
        verified_at: now,
        last_success_at: now,
        last_used_at: now,
        failure_count: 0,
        last_failure_reason: null,
      }, {
        // Must match `verified_legal_sources_dedupe2_idx` exactly: the index is
        // over generated plain columns, so bare column inference works.
        onConflict:
          "source_category,dedupe_docket,dedupe_statute_title,dedupe_statute_section,body_text_hash",
        ignoreDuplicates: false,
      })
      .select("id")
      .maybeSingle();


    if (error || !data) {
      return { ok: false, id: null, error: error?.message ?? "upsert_returned_no_row" };
    }
    const id = (data as { id: string }).id;

    const chunks = chunkText(text);
    await admin.from("verified_legal_source_texts").delete().eq("source_id", id);
    const { error: insErr } = await admin.from("verified_legal_source_texts").insert(
      chunks.map((c, i) => ({
        source_id: id,
        chunk_index: i,
        text: c,
        source_url: input.official_url,
      })),
    );
    if (insErr) return { ok: false, id, error: insErr.message };
    return { ok: true, id, error: null };
  } catch (e) {
    return { ok: false, id: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RecordFailureInput {
  category: CacheCategory;
  source_type: string;
  normalized_docket?: string | null;
  statute_title?: string | null;
  statute_section?: string | null;
  canonical_title?: string | null;
  official_url?: string | null;
  status: Extract<CacheStatus, "blocked" | "failed" | "identity_mismatch" | "bibliographic_mismatch">;
  reason: string;
  /** Cooldown scope — a failure only ever suppresses its own strategy. */
  strategy?: DiscoveryStrategy | null;
  discovery_version?: string | null;

}

/**
 * Negative rows carry a cooldown, never permanent suppression, and are never
 * citable — they exist only to stop the pipeline re-probing a dead endpoint.
 */
export async function recordSourceFailure(
  admin: Admin,
  input: RecordFailureInput,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    let host: string | null = null;
    if (input.official_url) {
      try {
        host = new URL(input.official_url).hostname;
      } catch { /* ignore */ }
    }
    const strategy = input.strategy ?? "unknown";
    const version = input.discovery_version ?? "v0";
    let q = admin.from("verified_legal_sources").select("id,failure_count")
      .eq("source_category", input.category)
      .neq("status", "verified")
      .eq("discovery_strategy", strategy)
      .eq("discovery_version", version);
    if (input.normalized_docket) q = q.eq("normalized_docket", input.normalized_docket);
    else if (input.statute_title) q = q.eq("statute_title", input.statute_title);
    else if (input.canonical_title) q = q.eq("canonical_title", input.canonical_title);
    else return { ok: false, error: "no_failure_key" };
    const { data } = await q.limit(1).maybeSingle();
    const existing = data as { id: string; failure_count: number } | null;
    const now = new Date().toISOString();

    if (existing) {
      const { error } = await admin.from("verified_legal_sources").update({
        status: input.status,
        failure_count: (existing.failure_count ?? 0) + 1,
        last_failure_reason: input.reason.slice(0, 300),
        official_url: input.official_url ?? null,
        source_host: host,
      }).eq("id", existing.id);
      return { ok: !error, error: error?.message ?? null };
    }

    const { error } = await admin.from("verified_legal_sources").insert({
      source_category: input.category,
      source_type: input.source_type,
      normalized_docket: input.normalized_docket ?? null,
      statute_title: input.statute_title ?? null,
      statute_section: input.statute_section ?? null,
      canonical_title: input.canonical_title ?? null,
      official_url: input.official_url ?? null,
      source_host: host,
      body_text_hash: `failure:${strategy}:${input.normalized_docket ?? input.canonical_title ?? input.statute_title ?? "?"}:${now}`,
      body_chars: 0,
      identity_validated: false,
      status: input.status,
      discovery_strategy: strategy,
      discovery_version: version,
      failure_count: 1,
      last_failure_reason: input.reason.slice(0, 300),
    });

    return { ok: !error, error: error?.message ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * identity_hardening_and_cache_purge_v1 — hard invalidation of a cached row
 * whose body failed re-validation. The body chunks are deleted so the wrong
 * text can never be served again, and the row becomes a negative row.
 */
export async function invalidateVerifiedSource(
  admin: Admin,
  id: string,
  reason: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await admin.from("verified_legal_source_texts").delete().eq("source_id", id);
    const { error } = await admin.from("verified_legal_sources").update({
      identity_validated: false,
      status: "identity_mismatch",
      body_chars: 0,
      identity_terms_matched: [],
      identity_evidence_type: [],
      identity_confidence: "none",
      identity_validation_version: "identity_hardening_v1",
      invalidated_reason: reason.slice(0, 300),
      last_failure_reason: reason.slice(0, 300),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { ok: !error, error: error?.message ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
