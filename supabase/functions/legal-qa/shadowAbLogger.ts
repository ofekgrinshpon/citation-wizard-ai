// Shadow A/B logger — runs a "legacy-style" drafter call IN PARALLEL with
// the structured (V2) flow already used in production, then writes a diff
// into `qa_logs.metadata.shadow_ab` on the canonical row that was just
// inserted. Never affects the user-facing response. Never throws.
//
// When to invoke:
//   - taskMode === "research"
//   - structured drafting was actually used (drafting_path === "structured")
//   - sample rate gate passes
//
// Schedule via `EdgeRuntime.waitUntil(...)` so the user response returns
// immediately and the shadow run continues in the background.

import { callDrafter } from "./aiProvider.ts";
import type { LegalDraftingInput } from "./contracts.ts";

const DEFAULT_SAMPLE_RATE = 1.0;

export interface ShadowAbInput {
  /** Question text (already trimmed/sanitized as in main flow). */
  question: string;
  /** Same system prompt the structured path used MINUS the claim-map block.
   *  Built by `buildLegacyShadowPrompt` below. */
  legacySystemPrompt: string;
  /** User-message identical to the production call. */
  userMessage: string;
  /** Max tokens used in production drafter call. */
  maxTokens: number;
  /** Production answer (to diff against). */
  productionAnswer: string;
  /** Production footnote count (already cleaned/renumbered). */
  productionFootnoteCount: number;
  /** Drafter model that produced the production answer. */
  productionDrafterModel: string;
  /** Drafting input that was used in production (structured run). */
  draftingInput: LegalDraftingInput;
  /** ID of the qa_logs row to UPDATE with the diff. */
  qaLogId: string;
  /** Service-role supabase client (bypasses RLS). */
  // deno-lint-ignore no-explicit-any
  adminClient: any;
}

export interface ShadowAbDiff {
  ran: true;
  legacy_drafter_model: string | "FAILED";
  legacy_latency_ms: number;
  production: {
    word_count: number;
    char_count: number;
    footnote_count: number;
    citation_density_per_100w: number;
    drafter_model: string;
  };
  legacy: {
    word_count: number;
    char_count: number;
    footnote_count: number;
    citation_density_per_100w: number;
  };
  delta: {
    word_count: number;            // legacy - production
    footnote_count: number;
    citation_density_per_100w: number;
  };
  claim_map_summary: {
    total: number;
    direct: number;
    qualified: number;
    omit: number;
    allowed_for_drafting: number;
  };
  anchored_source_ratio: number;   // anchored / total in source pack
  ts: string;
}

function shouldSample(rate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function getSampleRate(): number {
  const raw = Deno.env.get("SHADOW_AB_SAMPLE_RATE");
  if (!raw) return DEFAULT_SAMPLE_RATE;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_SAMPLE_RATE;
}

function isEnabled(): boolean {
  const flag = (Deno.env.get("SHADOW_AB_ENABLED") ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

/** Cheap text metrics — no NLP, just normalized counts. */
function textMetrics(text: string) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const footnoteCount = (text.match(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g) ?? []).length;
  return {
    word_count: wordCount,
    char_count: text.length,
    footnote_count: footnoteCount,
    citation_density_per_100w: wordCount > 0 ? +(footnoteCount * 100 / wordCount).toFixed(2) : 0,
  };
}

/**
 * Strip the `═══ מפת טענות מאושרת ═══` block from the production system
 * prompt — that gives a faithful "what would the legacy prompt have looked
 * like with the same retrieved sources" baseline. We don't reconstruct the
 * legacy path from scratch; we just remove the structured-only directives.
 */
export function buildLegacyShadowPrompt(structuredSystemPrompt: string): string {
  // Remove everything from the first `═══ מפת טענות מאושרת` marker
  // through (and including) the trailing claim-map JSON block. The block
  // ends at the closing `]` of the JSON.stringify(...). We use a
  // non-greedy regex bounded to the end of the prompt.
  return structuredSystemPrompt.replace(
    /\n*═══ מפת טענות מאושרת[\s\S]*$/u,
    "",
  );
}

/**
 * Run the shadow comparison. Never throws — all errors are logged and
 * absorbed. Designed to be passed to `EdgeRuntime.waitUntil(...)`.
 */
export async function runShadowAbComparison(input: ShadowAbInput): Promise<void> {
  if (!isEnabled()) return;
  const rate = getSampleRate();
  if (!shouldSample(rate)) {
    console.log(`[shadow-ab] skipped by sampling (rate=${rate})`);
    return;
  }

  const {
    legacySystemPrompt, userMessage, maxTokens,
    productionAnswer, productionFootnoteCount, productionDrafterModel,
    draftingInput, qaLogId, adminClient,
  } = input;

  try {
    const t0 = Date.now();
    const legacyRes = await callDrafter(legacySystemPrompt, userMessage, maxTokens, 90000);
    const latency = Date.now() - t0;

    const legacyText = legacyRes?.text ?? "";
    const legacyModel = legacyRes?.modelUsed ?? "FAILED";

    const prodMetrics = textMetrics(productionAnswer);
    // Trust the actual cleaned footnote count from production over the
    // superscript regex when it's available — the regex is the only thing
    // we can compute for the legacy shadow text.
    prodMetrics.footnote_count = productionFootnoteCount;
    prodMetrics.citation_density_per_100w = prodMetrics.word_count > 0
      ? +(productionFootnoteCount * 100 / prodMetrics.word_count).toFixed(2)
      : 0;

    const legacyMetrics = textMetrics(legacyText);

    const cm = draftingInput.claimMap;
    let direct = 0, qualified = 0, omit = 0;
    for (const c of cm.claims) {
      if (c.statementMode === "direct") direct++;
      else if (c.statementMode === "qualified") qualified++;
      else omit++;
    }
    const allowedForDrafting = direct + qualified;

    const sp = draftingInput.sourcePack;
    const allItems = [...sp.coreSources, ...sp.supportingSources, ...sp.secondarySources];
    const anchored = allItems.filter((i) => i.anchorPresent).length;
    const anchoredRatio = allItems.length > 0
      ? +(anchored / allItems.length).toFixed(3)
      : 0;

    const diff: ShadowAbDiff = {
      ran: true,
      legacy_drafter_model: legacyModel,
      legacy_latency_ms: latency,
      production: {
        ...prodMetrics,
        drafter_model: productionDrafterModel,
      },
      legacy: legacyMetrics,
      delta: {
        word_count: legacyMetrics.word_count - prodMetrics.word_count,
        footnote_count: legacyMetrics.footnote_count - prodMetrics.footnote_count,
        citation_density_per_100w: +(
          legacyMetrics.citation_density_per_100w - prodMetrics.citation_density_per_100w
        ).toFixed(2),
      },
      claim_map_summary: {
        total: cm.claims.length,
        direct, qualified, omit,
        allowed_for_drafting: allowedForDrafting,
      },
      anchored_source_ratio: anchoredRatio,
      ts: new Date().toISOString(),
    };

    console.log(
      `[shadow-ab] ran qa_log=${qaLogId} prod=${prodMetrics.word_count}w/${prodMetrics.footnote_count}fn ` +
      `legacy=${legacyMetrics.word_count}w/${legacyMetrics.footnote_count}fn ` +
      `Δdensity=${diff.delta.citation_density_per_100w} latency=${latency}ms`,
    );

    // Read existing metadata, merge shadow_ab key, write back. We avoid
    // fancy jsonb operators because the edge runtime uses the JS client.
    const { data: existing, error: readErr } = await adminClient
      .from("qa_logs")
      .select("metadata")
      .eq("id", qaLogId)
      .maybeSingle();

    if (readErr) {
      console.error("[shadow-ab] failed to read existing metadata:", readErr);
      return;
    }

    const merged = {
      ...(existing?.metadata ?? {}),
      shadow_ab: diff,
    };

    const { error: updErr } = await adminClient
      .from("qa_logs")
      .update({ metadata: merged })
      .eq("id", qaLogId);

    if (updErr) {
      console.error("[shadow-ab] failed to update qa_logs.metadata:", updErr);
    }
  } catch (err) {
    console.error("[shadow-ab] non-fatal error:", err);
  }
}
