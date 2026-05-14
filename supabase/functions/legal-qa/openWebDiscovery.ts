// Phase 3 — Open Web Discovery (METADATA-ONLY).
//
// Discovery exists to RESOLVE entities and SUGGEST trusted-retrieval queries
// before the source pack is built. It NEVER produces legal conclusions and
// its raw snippets MUST NOT enter the source pack or final citations.
//
// Outputs are restricted to:
//   - resolved_entities                (statutes / cases / parties / dates)
//   - suggested_trusted_queries        (queries to feed trusted retrieval)
//   - candidate_authoritative_sources  (URLs as SEEDS only, tier-tagged)
//   - ambiguity_notes                  (short Hebrew strings, 1–2 lines)
//   - confidence                       (0..1)
//   - must_verify_before_answering     (boolean — gate signal for later phases)
//
// Anything resembling holdings / interpretation / normative claims is
// stripped by `sanitizeDiscovery` before the result leaves this module.
// Telemetry counts what was stripped (`sanitized_fields`).
//
// Single-pipeline gate: `MODE_PROFILES.openWebDiscovery` selects
// "off" | "conditional" | "always". Decision lives in `shouldRunDiscovery`.

import type { LegalIssueRoute } from "./legalIssueRouter.ts";
import type { ResearchDepth } from "./modeProfiles.ts";
import type { StageRun } from "./aiProvider.ts";
import type { LegalSourcePack, LegalSourcePackItem } from "./contracts.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Source authority tier. Discovery candidates are all `open_web_untrusted`
 *  by default; later phases may upgrade specific URLs after re-fetch via
 *  trusted retrieval layers. */
export type SourceTier =
  | "official"          // nevo / Knesset / court / sec.gov.il
  | "primary_legal"     // psakdin / takdin (judgment text)
  | "approved_secondary" // mishpatim, daat, academic journals
  | "open_web_untrusted"; // everything else (news, blogs, wiki)

export interface ResolvedEntity {
  type: "statute" | "case" | "party" | "doctrine" | "date" | "other";
  name: string;            // canonical Hebrew name
  aliases?: string[];      // alternative names spotted in snippets
  identifier?: string;     // docket number / statute year / etc.
  notes?: string;          // very short, factual; sanitizer strips legal claims
}

export interface CandidateSource {
  url: string;
  title: string;
  tier: SourceTier;
  /** Free-text snippet, BUT post-sanitization (no legal conclusions). */
  snippet?: string;
}

export interface OpenWebDiscovery {
  resolved_entities: ResolvedEntity[];
  suggested_trusted_queries: string[];
  candidate_authoritative_sources: CandidateSource[];
  ambiguity_notes: string[];
  confidence: number;
  must_verify_before_answering: boolean;
}

export type DiscoveryMode = "off" | "conditional" | "always";

export interface DiscoveryDecision {
  triggered: boolean;
  triggers: string[]; // human-readable reasons (telemetry only)
}

// ---------------------------------------------------------------------------
// Trigger logic
// ---------------------------------------------------------------------------

/**
 * Decide whether to run discovery for this request. PURE function — easy to
 * unit-test (no network, no side effects).
 *
 * - "off"        → never run.
 * - "always"     → always run (used for eval / debugging).
 * - "conditional" → run when ANY trigger fires:
 *      * router asks for current context;
 *      * router resolved a target statute (we want amendment / current text);
 *      * router classified the question as case_law_application or
 *        statutory_amendment_comparison (entity ambiguity is high);
 *      * router confidence is low (< 0.55) — we need extra signal;
 *      * router itself is missing (timeout / fallback) — high uncertainty;
 *      * the question contains current-context keywords;
 *      * Deep mode AND mode profile is "conditional" (Deep is allowed to
 *        opportunistically discover even on otherwise-quiet questions).
 */
export function shouldRunDiscovery(
  route: LegalIssueRoute | null,
  question: string,
  depth: ResearchDepth,
  mode: DiscoveryMode,
): DiscoveryDecision {
  if (mode === "off") return { triggered: false, triggers: [] };
  if (mode === "always") return { triggered: true, triggers: ["mode=always"] };

  const triggers: string[] = [];

  if (!route) {
    triggers.push("router_missing");
  } else {
    if (route.requires_current_context) triggers.push("requires_current_context");
    if (route.target_statute?.name) triggers.push("target_statute_present");
    if (
      route.query_type === "case_law_application" ||
      route.query_type === "statutory_amendment_comparison"
    ) {
      triggers.push(`query_type=${route.query_type}`);
    }
    if (typeof route.confidence === "number" && route.confidence < 0.55) {
      triggers.push("low_router_confidence");
    }
  }

  // Question-level signals (independent of router success).
  if (CURRENT_CONTEXT_RE.test(question)) triggers.push("question_current_context");

  // Deep mode is more permissive — opportunistic discovery is cheap relative
  // to the rest of the Deep envelope.
  if (depth === "deep" && triggers.length === 0) {
    triggers.push("deep_opportunistic");
  }

  return { triggered: triggers.length > 0, triggers };
}

// Hebrew text — \b is ASCII-only, so we use plain alternation. The phrases
// are content-bearing enough that substring matching is safe.
const CURRENT_CONTEXT_RE =
  /(כיום|נכון לעכשיו|נכון להיום|השנה|לאחרונה|בימים אלה|עדכני|מעודכן|תיקון אחרון|נוסח מעודכן)/;

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Phrases that indicate a legal conclusion / holding / normative claim.
 *  Snippets containing any of these are stripped from candidate sources. */
const FORBIDDEN_CONCLUSION_PHRASES: RegExp[] = [
  /נפסק/,
  /נקבע/,
  /קבע (?:בית המשפט|השופט)/,
  /ההלכה (?:היא|קובעת)/,
  /הפרשנות הנכונה/,
  /יש לפרש/,
  /יש לקבוע/,
  /(?:^|\s)ראוי(?:\s|$|\.|,)/,
  /מן הראוי/,
  /(?:^|\s)חייב(?:\s|$|\.|,)/,
  /(?:^|\s)אסור(?:\s|$|\.|,)/,
  /(?:^|\s)מותר(?:\s|$|\.|,)/,
  /(?:^|\s)זכאי(?:\s|$|\.|,)/,
  /הדין הוא/,
  /המסקנה היא/,
];

/**
 * Strip legal conclusions / normative claims from a free-text field.
 * Returns the cleaned string + a flag indicating whether anything was stripped.
 */
export function sanitizeText(input: string | undefined): {
  text: string;
  stripped: boolean;
} {
  if (!input) return { text: "", stripped: false };
  let stripped = false;
  // Sentence-level scrub: drop any sentence containing a forbidden phrase.
  const sentences = input.split(/(?<=[.!?\n])\s+/);
  const kept: string[] = [];
  for (const s of sentences) {
    const hit = FORBIDDEN_CONCLUSION_PHRASES.some((re) => re.test(s));
    if (hit) {
      stripped = true;
      continue;
    }
    kept.push(s);
  }
  return { text: kept.join(" ").trim(), stripped };
}

/** Tier-classify a URL by host. Conservative — anything unknown → untrusted. */
export function classifyUrlTier(url: string): SourceTier {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "open_web_untrusted";
  }
  if (
    host.endsWith("nevo.co.il") ||
    host.endsWith("knesset.gov.il") ||
    host.endsWith("court.gov.il") ||
    host.endsWith("gov.il")
  ) {
    return "official";
  }
  if (host.endsWith("psakdin.co.il") || host.endsWith("takdin.co.il")) {
    return "primary_legal";
  }
  if (
    host.endsWith("mishpatim.huji.ac.il") ||
    host.endsWith("daat.ac.il") ||
    host.endsWith("idi.org.il") ||
    /\.ac\.il$/.test(host)
  ) {
    return "approved_secondary";
  }
  return "open_web_untrusted";
}

interface SanitizeOutcome {
  discovery: OpenWebDiscovery;
  /** Per-field counts of how many items were stripped/cleaned. */
  sanitized_fields: {
    resolved_entities_notes_cleaned: number;
    candidate_snippets_cleaned: number;
    ambiguity_notes_cleaned: number;
    candidates_dropped_no_url: number;
  };
}

/** Apply all sanitization rules and return clean discovery + counters. */
export function sanitizeDiscovery(raw: OpenWebDiscovery): SanitizeOutcome {
  let entityNotesCleaned = 0;
  let snippetsCleaned = 0;
  let ambiguityCleaned = 0;
  let candidatesDropped = 0;

  const resolved_entities = (raw.resolved_entities ?? []).map((e) => {
    if (!e.notes) return e;
    const { text, stripped } = sanitizeText(e.notes);
    if (stripped) entityNotesCleaned++;
    return { ...e, notes: text || undefined };
  });

  const candidate_authoritative_sources: CandidateSource[] = [];
  for (const c of raw.candidate_authoritative_sources ?? []) {
    if (!c?.url || typeof c.url !== "string") {
      candidatesDropped++;
      continue;
    }
    const { text, stripped } = sanitizeText(c.snippet);
    if (stripped) snippetsCleaned++;
    candidate_authoritative_sources.push({
      url: c.url,
      title: (c.title ?? "").slice(0, 240),
      tier: classifyUrlTier(c.url),
      snippet: text || undefined,
    });
  }

  const ambiguity_notes: string[] = [];
  for (const n of raw.ambiguity_notes ?? []) {
    if (typeof n !== "string") continue;
    const { text, stripped } = sanitizeText(n);
    if (stripped) ambiguityCleaned++;
    if (text.trim().length > 0) ambiguity_notes.push(text.slice(0, 280));
  }

  const suggested_trusted_queries = (raw.suggested_trusted_queries ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim().slice(0, 200))
    .slice(0, 8);

  return {
    discovery: {
      resolved_entities,
      suggested_trusted_queries,
      candidate_authoritative_sources,
      ambiguity_notes,
      confidence:
        typeof raw.confidence === "number" && isFinite(raw.confidence)
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      must_verify_before_answering: raw.must_verify_before_answering === true,
    },
    sanitized_fields: {
      resolved_entities_notes_cleaned: entityNotesCleaned,
      candidate_snippets_cleaned: snippetsCleaned,
      ambiguity_notes_cleaned: ambiguityCleaned,
      candidates_dropped_no_url: candidatesDropped,
    },
  };
}

// ---------------------------------------------------------------------------
// Perplexity call (metadata-only)
// ---------------------------------------------------------------------------

const DISCOVERY_SYSTEM_PROMPT = `אתה שכבת DISCOVERY בלבד עבור צינור מחקר משפטי ישראלי.
מטרתך היחידה היא לזהות ישויות (חוקים, פסקי דין, צדדים, תאריכים, דוקטרינות), להציע שאילתות חיפוש ממוקדות לאיסוף מקורות סמכותיים, ולהצביע על אי-בהירויות.

מותר לך להחזיר:
- רשימת ישויות שזוהו (שם קנוני, כינויים, מזהה כגון מספר תיק / שנת חקיקה).
- שאילתות חיפוש מומלצות לאיסוף מקורות סמכותיים מאוחר יותר (3–6 שאילתות בעברית או עברית+אנגלית).
- מועמדים ל-URLים סמכותיים שראית בחיפוש, עם כותרת קצרה ו-snippet קצרצר.
- הערות אי-בהירות (1–2 שורות כל אחת).

אסור לך:
- להציג מסקנות משפטיות, הלכות, פרשנות חקיקה, או טענות נורמטיביות.
- להשתמש במילים כמו "נפסק", "נקבע", "ההלכה היא", "הפרשנות הנכונה", "ראוי", "חייב", "אסור", "זכאי".
- להמליץ על תשובה לשאלה.
- לכתוב snippet שמכיל ניתוח משפטי — רק עובדה זיהויית קצרה (כותרת, סעיף, צדדים, תאריך).

החזר JSON בלבד התואם לסכמה הבאה:
{
  "resolved_entities": [{type, name, aliases?, identifier?, notes?}],
  "suggested_trusted_queries": [string],
  "candidate_authoritative_sources": [{url, title, snippet?}],
  "ambiguity_notes": [string],
  "confidence": number (0..1),
  "must_verify_before_answering": boolean
}
ללא טקסט נוסף, ללא markdown, ללא הסברים.`;

/**
 * Run Perplexity discovery. Returns sanitized discovery + StageRun + counters.
 * On any error, returns `discovery: null` and an error StageRun — caller logs
 * telemetry but the pipeline is never blocked.
 */
export async function runOpenWebDiscovery(
  question: string,
  route: LegalIssueRoute | null,
  signal?: AbortSignal,
): Promise<{
  discovery: OpenWebDiscovery | null;
  run: StageRun;
  sanitized_fields: SanitizeOutcome["sanitized_fields"] | null;
}> {
  const startedAt = new Date().toISOString();
  const tStart = Date.now();
  const baseRun: Omit<StageRun, "completed_at" | "duration_ms" | "status"> = {
    stage: "open_web_discovery",
    provider: "perplexity",
    model: "sonar",
    started_at: startedAt,
  };

  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    return {
      discovery: null,
      sanitized_fields: null,
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: "error",
        error_message: "PERPLEXITY_API_KEY missing",
      },
    };
  }

  // Build context preamble from router output.
  const ctxLines: string[] = [];
  if (route?.legal_domain && route.legal_domain !== "unknown") {
    ctxLines.push(`תחום משפטי: ${route.legal_domain}`);
  }
  if (route?.target_statute?.name) {
    const sec = route.target_statute.section ? `, סעיף ${route.target_statute.section}` : "";
    const amd = route.target_statute.amendment === "latest" ? " (התיקון האחרון)" : "";
    ctxLines.push(`חוק יעד אפשרי: ${route.target_statute.name}${sec}${amd}`);
  }
  if (route?.query_type) ctxLines.push(`סוג שאלה: ${route.query_type}`);

  const userPrompt =
    (ctxLines.length > 0 ? `הקשר נתב פנימי:\n${ctxLines.join("\n")}\n\n` : "") +
    `שאלת המחקר:\n${question}\n\nהחזר JSON בלבד.`;

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        discovery: null,
        sanitized_fields: null,
        run: {
          ...baseRun,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - tStart,
          status: "error",
          error_message: `perplexity ${res.status}: ${errText.slice(0, 200)}`,
        },
      };
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(data?.citations) ? data.citations : [];

    let parsed: OpenWebDiscovery | null = null;
    try {
      // Strip optional ```json fences.
      const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      }
    } catch (_e) {
      parsed = null;
    }

    if (!parsed) {
      // Synthesize a minimal discovery from Perplexity citations alone so
      // we still get tier-tagged seeds — but no entities / no notes.
      parsed = {
        resolved_entities: [],
        suggested_trusted_queries: [],
        candidate_authoritative_sources: citations.map((u) => ({
          url: u,
          title: "",
          tier: "open_web_untrusted" as const,
        })),
        ambiguity_notes: [],
        confidence: 0.2,
        must_verify_before_answering: true,
      };
    } else {
      // Merge any extra Perplexity citations not already present.
      const seen = new Set(
        (parsed.candidate_authoritative_sources ?? []).map((c) => c?.url).filter(Boolean),
      );
      for (const u of citations) {
        if (!seen.has(u)) {
          (parsed.candidate_authoritative_sources ??= []).push({
            url: u,
            title: "",
            tier: "open_web_untrusted",
          });
          seen.add(u);
        }
      }
    }

    const { discovery, sanitized_fields } = sanitizeDiscovery(parsed);
    return {
      discovery,
      sanitized_fields,
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: "success",
      },
    };
  } catch (err) {
    return {
      discovery: null,
      sanitized_fields: null,
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: "error",
        error_message: (err as Error)?.message ?? String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Telemetry helpers
// ---------------------------------------------------------------------------

/** Build the per-request telemetry blob persisted under
 *  `qa_logs.metadata.research_safeguards.discovery`. Always small + flat
 *  (no snippets / no full URLs lists in the log to keep rows tidy). */
export function buildDiscoveryTelemetry(args: {
  decision: DiscoveryDecision;
  run: StageRun | null;
  discovery: OpenWebDiscovery | null;
  sanitized_fields: SanitizeOutcome["sanitized_fields"] | null;
}): Record<string, unknown> {
  const { decision, run, discovery, sanitized_fields } = args;
  const candidates = discovery?.candidate_authoritative_sources ?? [];
  const by_tier: Record<SourceTier, number> = {
    official: 0,
    primary_legal: 0,
    approved_secondary: 0,
    open_web_untrusted: 0,
  };
  for (const c of candidates) by_tier[c.tier] = (by_tier[c.tier] ?? 0) + 1;

  return {
    triggered: decision.triggered,
    triggers: decision.triggers,
    ran: !!run,
    status: run?.status ?? "not_run",
    duration_ms: run?.duration_ms ?? null,
    candidate_count: candidates.length,
    by_tier,
    resolved_entity_count: discovery?.resolved_entities.length ?? 0,
    suggested_query_count: discovery?.suggested_trusted_queries.length ?? 0,
    ambiguity_note_count: discovery?.ambiguity_notes.length ?? 0,
    must_verify_before_answering: discovery?.must_verify_before_answering ?? null,
    confidence: discovery?.confidence ?? null,
    sanitized_fields: sanitized_fields ?? null,
  };
}
