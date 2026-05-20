// Research V4 — simplified default Deep pipeline.
//
// Design goals (vs V3):
//   • ONE anchor source — the V3 LegalResearchPlan. AnswerMap is disabled,
//     so there is no parallel anchor planner, no anchor-merge layer, and no
//     V3→V2 id bridge to reason about.
//   • Same verifier / ledger / drafter as V2 (they already implement the
//     4-label support classification the user wants).
//   • A post-pass that scores final footnote citation quality and demands at
//     least 2 strong-quality, on-domain (or local) verified sources. When that
//     bar isn't met, V4 returns ok:false → caller falls back to V3, which
//     re-runs the same plan WITH AnswerMap enabled.
//
// V4 is intentionally a thin orchestrator. The hard work lives in V2/V3
// modules. This keeps rollback trivial (flip RESEARCH_PIPELINE=v3) and keeps
// V2/V3 untouched as the safety net.
//
// Gated by env `RESEARCH_PIPELINE` (default "v4"). Caller (`index.ts`) is
// responsible for the V4→V3→V1 fallback chain and for choosing which result
// to persist.

import { runResearchV3, type RunResearchV3Args, type RunResearchV3Result } from "./researchV3Pipeline.ts";
import { scoreCitationQuality } from "./citationQualityScorer.ts";
import { citationTier } from "./approvedDomains.ts";

export type RunResearchV4Args = RunResearchV3Args;
export type RunResearchV4Result = RunResearchV3Result;

/**
 * Pipeline selector. Returns "v4" (default) or "v3".
 * Anything else (including unset) falls back to "v4".
 */
export function researchPipelineMode(): "core" | "v4" | "v3" {
  const raw = (Deno.env.get("RESEARCH_PIPELINE") ?? "").trim().toLowerCase();
  if (raw === "core") return "core";
  if (raw === "v3") return "v3";
  return "v4";
}

const MIN_STRONG_SOURCES = 2;

interface FootnoteQuality {
  number: number;
  quality: "strong" | "weak" | "placeholder";
  on_domain: "local" | "tier_a" | "tier_b" | "off" | "no_url";
  counts_as_verified: boolean;
}

function classifyFootnote(fn: {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
}): FootnoteQuality {
  const q = scoreCitationQuality({
    citation: fn.citation,
    sourceType: fn.source_type,
    url: fn.url,
  });
  let onDomain: FootnoteQuality["on_domain"];
  if (!fn.url) {
    // No URL = comes from local DB / ingested corpus. Trust the verifier.
    onDomain = "local";
  } else {
    const tier = citationTier(fn.url);
    if (tier === "A") onDomain = "tier_a";
    else if (tier === "B") onDomain = "tier_b";
    else onDomain = "off";
  }
  // A footnote "counts as verified" for V4's coverage gate iff:
  //   • citation has strong shape (not placeholder, not weak), AND
  //   • either no URL (local DB) or URL is on the approved Tier A allowlist.
  // Tier B and off-domain do NOT count — they may be discovery noise.
  const countsAsVerified =
    q.quality === "strong" && (onDomain === "local" || onDomain === "tier_a");
  return {
    number: fn.number,
    quality: q.quality,
    on_domain: onDomain,
    counts_as_verified: countsAsVerified,
  };
}

export async function runResearchV4(args: RunResearchV4Args): Promise<RunResearchV4Result> {
  const t0 = Date.now();
  // V4 = V3 plan + V2 retrieval/verify/draft, with AnswerMap disabled.
  // We intentionally do NOT disable the V3 anchor-fallback (Perplexity bounded
  // by Tier A) — that's the only remaining external recall path, and V4
  // gates its output through the same verifier + post-pass.
  const inner = await runResearchV3({ ...args, disableAnswerMap: true });

  // Annotate metadata so admins can tell V4 ran even when it returns ok:false.
  const innerMeta = (inner.metadata ?? {}) as Record<string, unknown>;
  innerMeta.v4_path = "deep_v4";
  innerMeta.v4_total_duration_ms = Date.now() - t0;

  if (!inner.ok) {
    innerMeta.v4_fallback_reason = inner.fallbackReason ?? "v3_inner_fallback";
    return { ...inner, metadata: innerMeta };
  }

  // ── Citation-quality post-pass ────────────────────────────────────
  // Score every final footnote. Demand ≥ MIN_STRONG_SOURCES that are both
  // strong-shape AND from a trusted origin (local or Tier A). If the bar
  // isn't met, fall back to V3 (which re-runs WITH AnswerMap to widen the
  // recall pool).
  const perFootnote = inner.footnotes.map(classifyFootnote);
  const verifiedCount = perFootnote.filter((f) => f.counts_as_verified).length;
  const placeholderCount = perFootnote.filter((f) => f.quality === "placeholder").length;
  const offDomainCount = perFootnote.filter((f) => f.on_domain === "off").length;
  const tierBCount = perFootnote.filter((f) => f.on_domain === "tier_b").length;

  innerMeta.v4_citation_quality = {
    total_footnotes: perFootnote.length,
    strong: perFootnote.filter((f) => f.quality === "strong").length,
    weak: perFootnote.filter((f) => f.quality === "weak").length,
    placeholder: placeholderCount,
    off_domain: offDomainCount,
    tier_b: tierBCount,
    local_or_tier_a: perFootnote.filter(
      (f) => f.on_domain === "local" || f.on_domain === "tier_a",
    ).length,
    verified_strong_count: verifiedCount,
    min_required: MIN_STRONG_SOURCES,
    per_footnote: perFootnote,
  };

  if (verifiedCount < MIN_STRONG_SOURCES) {
    innerMeta.v4_fallback_reason = "insufficient_verified_sources";
    return {
      ok: false,
      fallbackReason: "insufficient_verified_sources",
      answer: "",
      footnotes: [],
      citations: [],
      metadata: innerMeta,
    };
  }

  return { ...inner, metadata: innerMeta };
}
