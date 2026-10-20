import { telemetryBody, reportZeroWork, type CostTelemetry } from "@/lib/costTelemetry";
import {
  normalizeAbbreviations,
  SOURCE_TYPE_LABELS,
  type SourceType,
} from "@/data/abbreviations";
import { resolveSourceType } from "@/lib/sourceTypeClassifier";
import {
  buildEnginePromptHint,
  validateAIResponse,
  getMissingFieldsSummary,
} from "@/lib/citationValidation";
import {
  findVerifiedSourceMatch,
  classifyVerifiedSource,
  getVerifiedCategoryLabel,
  type VerifiedSourceMatch,
} from "@/lib/verifiedSources";
import { validateCitationInput } from "@/lib/citationInputValidation";
import { extractCitationFromResponse } from "@/lib/citationUtils";
import { invokeFunction, retryCitationFunction } from "@/lib/functionError";
import type { CitationRetryDescriptor } from "@/lib/citationRequestIdentity";
import { handleRefundResponse } from "@/lib/refundResponse";
import { renderForeignCitation, renderForeignDetection } from "@/data/bluebook";
import { citationTextOnly } from "@/lib/citationSegments";
import { detectForeignSource } from "@/data/bluebook/extract";
import {
  isForeignSourceType,
  toForeignIdentity,
  toSourceType,
  type ForeignFields,
  type ForeignJurisdiction,
  type ForeignSourceKind,
} from "@/data/bluebook/types";
import type { ForeignDetection } from "@/data/bluebook/extract";
import { parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";
import { extractWorkIdentifiers } from "../../supabase/functions/_shared/workIdentifiers";
import { buildForeignArticleRequest, renderForeignArticleCache, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { citationDiagnosticBody, observeCitationDiagnostic, type CitationDiagnosticActivation } from "@/lib/citationDiagnostic";

interface ForeignLookupResponse {
  identity?: { matched?: boolean; jurisdiction?: "US" | "UK"; conflicts?: string[] };
  fields?: Record<string, string>;
  articleResolution?: "resolved" | "incomplete" | "conflict";
  disambiguation?: Array<{ jurisdiction: "US" | "UK"; label: string; url: string }>;
}

/** "X v. Y" shape (any common-law jurisdiction). */
const FOREIGN_CASE_SHAPE = /[A-Za-z][^\n]*?\s+v(?:s)?\.?\s+[A-Za-z]/;

export function extractForeignCaseName(raw: string): string | null {
  const m = raw.match(/^\s*(.+?\s+v(?:s)?\.?\s+.+?)(?:\s*[,(\[]\s*(?:\d|\[)|\s*\(|\s*\[|$)/);
  return m ? m[1].trim().replace(/[,\s]+$/, "") : null;
}

/** Statute name anchor: leading text before any section/code apparatus. */
export function extractStatuteNameHint(raw: string): string | null {
  const head = raw.split(/§|,/)[0].replace(/\b(?:1[6-9]|20)\d{2}\b/g, "").trim();
  return /[A-Za-z]{3}/.test(head) ? head : null;
}

/** Statute section anchor(s): the § tail, preserving lists and ranges. */
export function extractStatuteSectionsHint(raw: string): string[] | null {
  const m = raw.match(/§{1,2}\s*([0-9A-Za-z][0-9A-Za-z().\-–]*(?:\s*,\s*[0-9A-Za-z().\-–]+)*)/);
  if (!m) return null;
  const items = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
}

/**
 * Decide whether a foreign input is eligible for the grounded lookup and
 * with which jurisdiction. A case-shaped input without an explicit
 * US/UK anchor goes out as "UNKNOWN": the lookup verifies the jurisdiction
 * from the matched record instead of the client guessing it.
 */
export function planForeignLookup(
  sourceType: SourceType,
  raw: string,
  detection: ForeignDetection | null,
): { kind: ForeignSourceKind; jurisdiction: "US" | "UK" | "OTHER" | "UNKNOWN" } | null {
  const identity = toForeignIdentity(sourceType);
  const caseShaped = FOREIGN_CASE_SHAPE.test(raw);
  if (detection && detection.kind === "case" && (detection.jurisdiction === "US" || detection.jurisdiction === "UK")) {
    return { kind: "case", jurisdiction: detection.jurisdiction };
  }
  // Statutes: the supported bound is explicit — US/UK only, from the source
  // type or a deterministic detection. UNKNOWN is never treated as US, and an
  // unresolved statute jurisdiction is unsupported, not guessed.
  if (identity?.kind === "statute" || detection?.kind === "statute") {
    const jur = detection?.kind === "statute" && (detection.jurisdiction === "US" || detection.jurisdiction === "UK")
      ? detection.jurisdiction
      : identity?.kind === "statute" && (identity.jurisdiction === "US" || identity.jurisdiction === "UK")
        ? identity.jurisdiction
        : null;
    return jur ? { kind: "statute", jurisdiction: jur } : null;
  }
  if (identity && ["journal_article", "book", "book_chapter"].includes(identity.kind)) {
    return { kind: identity.kind, jurisdiction: identity.jurisdiction };
  }
  if (identity?.kind === "case" || ((sourceType === "foreign") && caseShaped)) {
    if (!caseShaped) return null;
    // Explicit anchors in the text itself (court / reporter) are fast-path identity.
    if (identity?.kind === "case" && identity.jurisdiction === "US" && /\b(Cir\.|U\.S\.|F\.\s?(?:2d|3d|4th|Supp)|S\.D\.N\.Y\.|D\.\s?[A-Z])/.test(raw)) {
      return { kind: "case", jurisdiction: "US" };
    }
    if (/\b(UKSC|UKHL|EWCA|EWHC|UKPC|WLR|All ER)\b/.test(raw)) return { kind: "case", jurisdiction: "UK" };
    return { kind: "case", jurisdiction: "UNKNOWN" };
  }
  return null;
}

/** Pinpoint references (סעיף / עמ' / פסקה …) are not master sources. */
export const PINPOINT_RE =
  /(?:סעיף|ס['׳]|פסקה|פס['׳]|עמ['׳]|לפסק\s+דינ[וה]\s+של|בעמ['׳]|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;

export class CitationRunError extends Error {
  code: string;
  userMessage: string;
  isInvalidInput: boolean;
  isInsufficientCredits: boolean;
  /** Existing request identity for read-only status navigation. */
  requestId?: string;
  /** Explicit, server-confirmed failure recovery. Never used by generic retries. */
  citationRetry?: CitationRunRetry;
  recovery?: CitationRunRecovery;
  constructor(opts: {
    code: string;
    userMessage: string;
    isInvalidInput?: boolean;
    isInsufficientCredits?: boolean;
    requestId?: string;
    citationRetry?: CitationRunRetry;
    recovery?: CitationRunRecovery;
  }) {
    super(opts.code);
    this.name = "CitationRunError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.isInvalidInput = !!opts.isInvalidInput;
    this.isInsufficientCredits = !!opts.isInsufficientCredits;
    this.requestId = opts.requestId;
    this.citationRetry = opts.citationRetry;
    this.recovery = opts.recovery;
  }
}

/** In-memory only: includes the original prepared render context, never browser storage. */
export interface CitationRunRecovery {
  readonly retry: (isResultCurrent?: () => boolean) => Promise<RunCitationResult>;
}

export interface CitationRunRetry extends CitationRunRecovery {
  readonly descriptor: CitationRetryDescriptor;
}

export interface RunCitationOptions {
  rawInput: string;
  /** Prevent dispatch/delivery after row edits, navigation or account changes. */
  isResultCurrent?: () => boolean;
  /** Manual source-type override from the UI. Skips the classifier. */
  overrideType?: SourceType;
  projectId?: string | null;
  /**
   * Look up the verified-source store before calling the engine. A direct
   * match is returned as-is (no engine call, no credit charge).
   */
  useVerifiedStore?: boolean;
  /** Cost-telemetry attribution (never billing). */
  telemetry?: CostTelemetry;
  /** Temporary admin-only observer activation, prepared by the diagnostic readiness check. */
  diagnostic?: CitationDiagnosticActivation;
}

export interface RunCitationResult {
  /** Full engine reply (may include explanation / warning lines). */
  reply: string;
  /** The citation line only. */
  citation: string;
  sourceType: SourceType;
  sourceLabel: string;
  /** True when the answer came from the verified-source store. */
  fromVerifiedStore: boolean;
  status: "valid" | "warning" | "verified";
  warningMsg?: string;
  /** Carried so later verify-source calls keep attribution. */
  telemetry?: CostTelemetry;
}

const MIN_CITATION_LENGTH = 10;

function isFragment(citation: string): boolean {
  return (
    !citation ||
    citation.trim().length < MIN_CITATION_LENGTH ||
    /^\d+\.?$/.test(citation.trim())
  );
}

function isDirectVerifiedMatch(match: VerifiedSourceMatch, normalized: string): boolean {
  const name = normalizeAbbreviations(match.source_name).toLowerCase();
  const q = normalized.toLowerCase();
  return name.includes(q) || name === q || q.includes(name);
}

/**
 * The single citation pipeline shared by the citation wizard (אזכור אחיד)
 * and the batch footnote builder (הערות שוליים).
 *
 * input validation → verified-source match (direct hit / pinpoint hint)
 * → engine hint by source type → citation-chat (with requestId + projectId)
 * → refund handling → source-type re-classification → rule validation.
 */
export async function runCitation(opts: RunCitationOptions): Promise<RunCitationResult> {
  if (opts.isResultCurrent && !opts.isResultCurrent()) {
    throw new CitationRunError({ code: "CITATION_INPUT_CHANGED", userMessage: "הקלט או החשבון השתנו. לא נשלחה בקשה לעיבוד." });
  }
  const rawInput = opts.rawInput.trim();

  const inputCheck = validateCitationInput(rawInput);
  if (!inputCheck.valid) {
    throw new CitationRunError({
      code: "INVALID_INPUT",
      userMessage:
        inputCheck.messageHe || "לא זוהה טקסט משפטי ברור לאזכור.",
      isInvalidInput: true,
    });
  }

  const normalized = normalizeAbbreviations(rawInput);
  const isPinpoint = PINPOINT_RE.test(rawInput);

  let sourceType: SourceType;
  if (opts.overrideType) {
    sourceType = opts.overrideType;
  } else {
    const resolved = await resolveSourceType(normalized, opts.telemetry);
    sourceType = resolved.sourceType;
  }
  const sourceLabel = SOURCE_TYPE_LABELS[sourceType];
  const isHebrewArticle = sourceType === "article";
  const suppliedArticle = sourceType === "foreign_journal_article" ? parseForeignArticleInput(normalized) : null;

  let prompt = normalized;
  if (sourceType !== "unknown") {
    prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${buildEnginePromptHint(sourceType)}${normalized}`;
  }

  // 1) Verified-source store first — a direct hit costs no credit.
  let verifiedMatch: VerifiedSourceMatch | null = null;
  if (opts.useVerifiedStore !== false) {
    try {
      verifiedMatch = await findVerifiedSourceMatch(normalized);
    } catch {
      verifiedMatch = null;
    }
  }

  const cachedArticle = verifiedMatch && suppliedArticle
    ? renderForeignArticleCache(normalized, verifiedMatch.full_citation) : null;
  if (verifiedMatch && !isHebrewArticle && !isPinpoint && isDirectVerifiedMatch(verifiedMatch, normalized) &&
      (!suppliedArticle || cachedArticle)) {
    // Verified identity is always kept. Formatting may be deterministically
    // re-rendered when the stored citation carries enough structured fields;
    // otherwise the stored text is preserved as-is (never guessed).
    // Stored citations are marked text: detect from their plain reading.
    const reRendered = renderForeignCitation(citationTextOnly(verifiedMatch.full_citation));
    const citation = cachedArticle?.citation ?? (
      reRendered && reRendered.missing.length === 0 && !reRendered.unrepresented?.length
        ? reRendered.citation
        : verifiedMatch.full_citation);
    const cacheRender = cachedArticle ?? reRendered;
    const cacheWarnings = [...(cacheRender?.warnings ?? [])];
    if (cacheRender?.missing.length) cacheWarnings.push(`חסרים פרטים: ${getMissingFieldsSummary(sourceType, cacheRender.missing)}`);
    // Classifier cost (if any) stays attached to the same telemetryRequestId.
    reportZeroWork(opts.telemetry, "client_verified_store", "cache_hit");
    observeCitationDiagnostic(opts.diagnostic, rawInput, "cache_hit");
    return {
      telemetry: opts.telemetry,
      reply: cacheWarnings.length ? `${citation}\n⚠️ ${cacheWarnings.join(" ")}` : citation,
      citation,
      sourceType,
      sourceLabel: verifiedMatch.source_type || sourceLabel,
      fromVerifiedStore: true,
      status: cacheWarnings.length ? "warning" : "verified",
      warningMsg: cacheWarnings[0],
    };
  }

  // 1b) Deterministic Bluebook rendering for a clearly identified foreign
  // source (Israeli Rule 35.1). No model call, no fabricated fields.
  if (!isPinpoint && isForeignSourceType(sourceType)) {
    const identifiers = suppliedArticle ? extractWorkIdentifiers(normalized) : null;
    const hasIdentifier = !!(identifiers?.doi || identifiers?.sourceUrl || identifiers?.conflicts.length);
    const rendered = renderForeignCitation(hasIdentifier ? identifiers!.text : normalized);
    if (rendered && rendered.missing.length === 0) {
      reportZeroWork(opts.telemetry, "local_foreign_formatter", "deterministic");
      observeCitationDiagnostic(opts.diagnostic, rawInput, "deterministic");
      // Formatting complete supplied fields stays local. An explicit identifier
      // is not verified by rendering, and must not silently cause a billed lookup.
      const identifierWarning = hasIdentifier
        ? identifiers!.conflicts.length
          ? "נמצאו מזהים סותרים או קישור שאינו נתמך; לא אומתה התאמתם לפרטי המאמר שסיפקתם."
          : "לא אומתה התאמת ה־DOI או הקישור לפרטי המאמר שסיפקתם."
        : undefined;
      return {
        telemetry: opts.telemetry,
        // Renderer warnings (e.g. supplied details kept verbatim) must reach the reply.
        reply: identifierWarning || rendered.warnings.length
          ? `${rendered.citation}\n⚠️ ${[identifierWarning, ...rendered.warnings].filter(Boolean).join(" ")}`
          : rendered.citation,
        citation: rendered.citation,
        sourceType: rendered.detection.sourceType,
        sourceLabel: SOURCE_TYPE_LABELS[rendered.detection.sourceType],
        fromVerifiedStore: false,
        status: identifierWarning || rendered.warnings.length ? "warning" : "valid",
        warningMsg: identifierWarning ?? rendered.warnings[0],
      };
    }
  }

  // 1c) Milestone 2B — grounded foreign lookup. Only when the deterministic
  // foreign path declined AND the source type is a supported lookup family.
  // The typed contract is sent explicitly; search hints ≠ evidence; the
  // deterministic Bluebook renderer remains the sole formatter.
  let foreignLookupRequest: Record<string, unknown> | null = null;
  let foreignDetection = isForeignSourceType(sourceType) && !isPinpoint
    ? detectForeignSource(normalized)
    : null;
  if (!isPinpoint && isForeignSourceType(sourceType)) {
    const plan = planForeignLookup(sourceType, normalized, foreignDetection);
    if (plan) {
      const parsedFields: Record<string, string> = plan.kind === "journal_article" ? parseForeignArticleInput(normalized) : {};
      if (foreignDetection) {
        for (const [k, v] of Object.entries(foreignDetection.fields as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) parsedFields[k] = v.trim();
          else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) parsedFields[k] = v.join(", ");
        }
      }
      if (plan.kind === "case" && !parsedFields.caseName) {
        const name = extractForeignCaseName(normalized);
        if (name) parsedFields.caseName = name;
      }
      if (plan.kind === "statute") {
        if (!parsedFields.statuteName) {
          const name = extractStatuteNameHint(normalized);
          if (name) parsedFields.statuteName = name;
        }
        if (!parsedFields.section && !parsedFields.sections) {
          const sections = extractStatuteSectionsHint(normalized);
          if (sections) {
            if (sections.length > 1) parsedFields.sections = sections.join(", ");
            else parsedFields.section = sections[0];
          }
        }
        const year = normalized.match(/\b((?:1[6-9]|20)\d{2})\b/)?.[1];
        if (year && !parsedFields.year) parsedFields.year = year;
      }
      foreignLookupRequest = plan.kind === "journal_article" ? { ...buildForeignArticleRequest(normalized) } : {
        enabled: true,
        kind: plan.kind,
        jurisdiction: plan.jurisdiction,
        rawInput: normalized,
        parsedFields,
      };
    }
  }

  // 2) Pinpoint + known master source → feed the verified details as a hint.
  if (verifiedMatch && !isHebrewArticle && isPinpoint) {
    const category = getVerifiedCategoryLabel(
      classifyVerifiedSource({
        rawInput: verifiedMatch.source_name,
        fullCitation: verifiedMatch.full_citation,
        sourceType: verifiedMatch.source_type,
      })
    );
    prompt = `${prompt}\n\n══ מקור מאומת (${category}) ══\nהשתמש בפרטים הבאים מהמקור המאומת כדי להשלים את האזכור:\nשם: ${verifiedMatch.source_name}\nאזכור מלא: ${verifiedMatch.full_citation}\n══════════════════════════════════`;
  }

  observeCitationDiagnostic(opts.diagnostic, rawInput, "client_route", { articleRoute: foreignLookupRequest?.kind === "journal_article" });
  // Keep the exact prepared request and render context for a user-confirmed
  // successor. Retrying never repeats classification, verified-store search,
  // or the deterministic routing decisions above.
  const preparedBody = {
    messages: [{ role: "user", content: prompt }],
    ...(isHebrewArticle ? { rawInput: normalized } : {}),
    requestId: crypto.randomUUID(),
    ...telemetryBody(opts.telemetry),
    ...(foreignLookupRequest ? { foreignLookup: foreignLookupRequest } : {}),
    ...citationDiagnosticBody(opts.diagnostic, rawInput),
  };
  return invokePrepared();

  async function invokePrepared(
    retryDescriptor?: CitationRetryDescriptor,
    isResultCurrent = opts.isResultCurrent,
  ): Promise<RunCitationResult> {
    if (isResultCurrent && !isResultCurrent()) {
      throw new CitationRunError({ code: "CITATION_INPUT_CHANGED", userMessage: "הקלט או החשבון השתנו. לא נשלח ניסיון חדש." });
    }
    const { data, errorInfo } = retryDescriptor
      ? await retryCitationFunction<{ content?: string } & Record<string, unknown>>(
        retryDescriptor, { isCitationResultCurrent: isResultCurrent })
      : await invokeFunction<{ content?: string } & Record<string, unknown>>(
        "citation-chat", preparedBody,
        { projectId: opts.projectId ?? null, isCitationResultCurrent: isResultCurrent });

    if (isResultCurrent && !isResultCurrent()) {
      throw new CitationRunError({ code: "CITATION_INPUT_CHANGED", userMessage: "הקלט או החשבון השתנו. התוצאה הקודמת לא הוחלה." });
    }
    observeCitationDiagnostic(opts.diagnostic, rawInput, errorInfo ? "client_error" : "response", {
      server: errorInfo ? errorInfo.body?.citationDiagnostic : data?.citationDiagnostic,
      httpStatus: errorInfo?.status ?? (data ? 200 : null),
    });
    if (errorInfo) {
      throw new CitationRunError({
        code: errorInfo.code || `HTTP_${errorInfo.status ?? "ERR"}`,
        userMessage: errorInfo.message,
        isInvalidInput: errorInfo.isInvalidInput,
        isInsufficientCredits: errorInfo.isInsufficientCredits,
        requestId: errorInfo.isInvalidInput ? undefined : errorInfo.requestId ?? undefined,
        recovery: Object.freeze({ retry: (isCurrent?: () => boolean) => invokePrepared(undefined, isCurrent) }),
        citationRetry: errorInfo.citationRetry ? Object.freeze({
          descriptor: errorInfo.citationRetry,
          retry: (isCurrent?: () => boolean) => invokePrepared(errorInfo.citationRetry, isCurrent),
        }) : undefined,
      });
    }

    handleRefundResponse(data);
    return renderPreparedResponse(data);
  }

  function renderPreparedResponse(data: ({ content?: string } & Record<string, unknown>) | null): RunCitationResult {
    const rejectUnusableResponse = (code: string, userMessage: string): never => {
      // A transport-successful response is not proof of usable citation output.
      // Rechecking this unchanged row only re-renders the retained response; it
      // must not silently become another paid engine call or a failed-parent retry.
      throw new CitationRunError({ code, userMessage, recovery: Object.freeze({
        retry: async (isCurrent?: () => boolean) => {
          if (isCurrent && !isCurrent()) throw new CitationRunError({
            code: "CITATION_INPUT_CHANGED", userMessage: "הקלט או החשבון השתנו. התוצאה הקודמת לא הוחלה.",
          });
          return renderPreparedResponse(data);
        },
      }) });
    };

    // 3a) M2B: grounded foreign metadata returned → merge + deterministic render.
    // User-supplied identity anchors win; grounded lookup fields fill the gaps;
    // anything ungrounded stays [חסר: …] via the existing renderer behavior.
    const fl = (data as { foreignLookup?: ForeignLookupResponse } | null)?.foreignLookup;
    if (foreignLookupRequest && fl?.disambiguation && fl.disambiguation.length > 1) {
      const lines = fl.disambiguation.map(
        (o, i) => `${i + 1}. ${o.label} (${o.jurisdiction === "UK" ? "בריטניה" : "ארה\"ב"}) — ${o.url}`,
      );
      const reply = `נמצאו כמה פסקי דין אפשריים בשם זה. כדי לא לנחש, בחרו את הנכון והוסיפו את הערכאה או השנה:\n${lines.join("\n")}`;
      return {
        telemetry: opts.telemetry,
        reply,
        citation: "",
        sourceType,
        sourceLabel: SOURCE_TYPE_LABELS[sourceType],
        fromVerifiedStore: false,
        status: "warning",
        warningMsg: "נדרשת בחירה בין כמה פסקי דין",
      };
    }
    if (foreignLookupRequest?.kind === "journal_article") {
      const article = renderForeignArticleLookup(foreignLookupRequest as { parsedFields: Record<string, string> }, fl);
      if (article) return { ...article, telemetry: opts.telemetry, sourceType, sourceLabel: SOURCE_TYPE_LABELS[sourceType], fromVerifiedStore: false };
    }
    if (foreignLookupRequest && fl?.fields && fl.identity?.matched && Object.keys(fl.fields).length > 0) {
      const req = foreignLookupRequest as { kind: ForeignSourceKind; jurisdiction: string; parsedFields: Record<string, string> };
      // Jurisdiction comes from the verified record when the input did not state it.
      const resolvedJur: ForeignJurisdiction | null =
        req.kind === "case"
          ? (fl.identity?.jurisdiction ?? (req.jurisdiction === "US" || req.jurisdiction === "UK" ? req.jurisdiction : null))
          : ((req.jurisdiction as ForeignJurisdiction) ?? "OTHER");
      if (resolvedJur) {
        const effectiveType = req.kind === "case" ? toSourceType("case", resolvedJur) : sourceType;
        const baseFields: Record<string, unknown> = { ...(fl.fields as Record<string, unknown>) };
        // Never overwrite what the user supplied; lookup only fills gaps.
        for (const [k, v] of Object.entries(req.parsedFields)) {
          if (typeof v === "string" && v.trim()) baseFields[k] = v.trim();
        }
        const detection = {
          sourceType: effectiveType,
          kind: req.kind,
          jurisdiction: resolvedJur,
          confidence: "deterministic" as const,
          fields: baseFields as unknown as ForeignFields,
        };
        const rendered = renderForeignDetection(detection);
        if (rendered && rendered.citation.trim()) {
          const missingSummary =
            rendered.missing.length > 0
              ? getMissingFieldsSummary(effectiveType, rendered.missing)
              : null;
          const warningBits = [...rendered.warnings];
          if (missingSummary) warningBits.push(`חסרים פרטים: ${missingSummary}`);
          const hasMissing = rendered.missing.length > 0;
          const reply = hasMissing || warningBits.length
            ? `${rendered.citation}\n⚠️ ${warningBits.join(" ") || missingSummary}`
            : rendered.citation;
          return {
            telemetry: opts.telemetry,
            reply,
            citation: rendered.citation,
            sourceType: effectiveType,
            sourceLabel: SOURCE_TYPE_LABELS[effectiveType],
            fromVerifiedStore: false,
            status: hasMissing || warningBits.length ? "warning" : "valid",
            warningMsg: warningBits[0],
          };
        }
      }
    }

    const reply = (data?.content as string) || "";
    if (!reply.trim()) {
      rejectUnusableResponse("EMPTY_RESPONSE",
        "השרת החזיר תשובה ללא אזכור שניתן להציג. לא תופעל בקשה נוספת עבור קלט זה והחזר שימוש לא אושר. שמרו את פרטי הבקשה לבירור.");
    }

    // 4) Re-classify from the answer (database → published when פ"ד appears).
    let effectiveSourceType = sourceType;
    if (effectiveSourceType === "case_law_database" && /פ["״]ד\s+[א-ת]+/.test(reply)) {
      effectiveSourceType = "case_law_published";
    }

    const citation = extractCitationFromResponse(reply) || reply.trim();
    if (isFragment(citation)) {
      rejectUnusableResponse("FRAGMENT_RESPONSE",
        "התוצאה שהתקבלה אינה אזכור שלם. לא תופעל בקשה נוספת עבור קלט זה והחזר שימוש לא אושר. שמרו את פרטי הבקשה לבירור.");
    }

    // 5) Rule validation — append a concrete missing-field warning.
    const validation = validateAIResponse(reply, effectiveSourceType);
    let finalReply = reply;
    let warningMsg: string | undefined;
    if (!validation.isComplete && validation.missingFields.length > 0) {
      const summary = getMissingFieldsSummary(
        validation.effectiveSourceType ?? effectiveSourceType,
        validation.missingFields
      );
      if (summary) {
        warningMsg = summary;
        if (!/⚠️/.test(reply)) finalReply = `${reply}\n⚠️ ${summary}`;
      }
    }

    const hasMarker = /\[חסר:/.test(finalReply) || /⚠️/.test(finalReply);

    return {
      telemetry: opts.telemetry,
      reply: finalReply,
      citation,
      sourceType: effectiveSourceType,
      sourceLabel: SOURCE_TYPE_LABELS[effectiveSourceType],
      fromVerifiedStore: false,
      status: hasMarker ? "warning" : "valid",
      warningMsg: hasMarker ? warningMsg || "חסרים פרטים – ראה סימון בתוצאה" : undefined,
    };
  }

}
