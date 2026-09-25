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
import { invokeFunction } from "@/lib/functionError";
import { handleRefundResponse } from "@/lib/refundResponse";
import { renderForeignCitation, renderForeignDetection } from "@/data/bluebook";
import { detectForeignSource } from "@/data/bluebook/extract";
import {
  isForeignSourceType,
  toForeignIdentity,
  type ForeignFields,
} from "@/data/bluebook/types";

/** Pinpoint references (סעיף / עמ' / פסקה …) are not master sources. */
export const PINPOINT_RE =
  /(?:סעיף|ס['׳]|פסקה|פס['׳]|עמ['׳]|לפסק\s+דינ[וה]\s+של|בעמ['׳]|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;

export class CitationRunError extends Error {
  code: string;
  userMessage: string;
  isInvalidInput: boolean;
  isInsufficientCredits: boolean;
  constructor(opts: {
    code: string;
    userMessage: string;
    isInvalidInput?: boolean;
    isInsufficientCredits?: boolean;
  }) {
    super(opts.code);
    this.name = "CitationRunError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.isInvalidInput = !!opts.isInvalidInput;
    this.isInsufficientCredits = !!opts.isInsufficientCredits;
  }
}

export interface RunCitationOptions {
  rawInput: string;
  /** Manual source-type override from the UI. Skips the classifier. */
  overrideType?: SourceType;
  projectId?: string | null;
  /**
   * Look up the verified-source store before calling the engine. A direct
   * match is returned as-is (no engine call, no credit charge).
   */
  useVerifiedStore?: boolean;
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
    const resolved = await resolveSourceType(normalized);
    sourceType = resolved.sourceType;
  }
  const sourceLabel = SOURCE_TYPE_LABELS[sourceType];

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

  if (verifiedMatch && !isPinpoint && isDirectVerifiedMatch(verifiedMatch, normalized)) {
    // Verified identity is always kept. Formatting may be deterministically
    // re-rendered when the stored citation carries enough structured fields;
    // otherwise the stored text is preserved as-is (never guessed).
    const reRendered = renderForeignCitation(verifiedMatch.full_citation);
    const citation =
      reRendered && reRendered.missing.length === 0
        ? reRendered.citation
        : verifiedMatch.full_citation;
    return {
      reply: citation,
      citation,
      sourceType,
      sourceLabel: verifiedMatch.source_type || sourceLabel,
      fromVerifiedStore: true,
      status: "verified",
    };
  }

  // 1b) Deterministic Bluebook rendering for a clearly identified foreign
  // source (Israeli Rule 35.1). No model call, no fabricated fields.
  if (!isPinpoint && isForeignSourceType(sourceType)) {
    const rendered = renderForeignCitation(normalized);
    if (rendered && rendered.missing.length === 0) {
      return {
        reply: rendered.citation,
        citation: rendered.citation,
        sourceType: rendered.detection.sourceType,
        sourceLabel: SOURCE_TYPE_LABELS[rendered.detection.sourceType],
        fromVerifiedStore: false,
        status: rendered.warnings.length ? "warning" : "valid",
        warningMsg: rendered.warnings[0],
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
    const identity = toForeignIdentity(sourceType);
    if (
      identity &&
      ["case", "journal_article", "book", "book_chapter"].includes(identity.kind) &&
      (identity.jurisdiction === "US" || identity.jurisdiction === "UK")
    ) {
      const parsedFields: Record<string, string> = {};
      if (foreignDetection) {
        for (const [k, v] of Object.entries(foreignDetection.fields as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) parsedFields[k] = v.trim();
        }
      }
      foreignLookupRequest = {
        enabled: true,
        kind: identity.kind,
        jurisdiction: identity.jurisdiction,
        rawInput: normalized,
        parsedFields,
      };
    }
  }

  // 2) Pinpoint + known master source → feed the verified details as a hint.
  if (verifiedMatch && isPinpoint) {
    const category = getVerifiedCategoryLabel(
      classifyVerifiedSource({
        rawInput: verifiedMatch.source_name,
        fullCitation: verifiedMatch.full_citation,
        sourceType: verifiedMatch.source_type,
      })
    );
    prompt = `${prompt}\n\n══ מקור מאומת (${category}) ══\nהשתמש בפרטים הבאים מהמקור המאומת כדי להשלים את האזכור:\nשם: ${verifiedMatch.source_name}\nאזכור מלא: ${verifiedMatch.full_citation}\n══════════════════════════════════`;
  }

  // 3) Engine call.
  const { data, errorInfo } = await invokeFunction<{ content?: string } & Record<string, unknown>>(
    "citation-chat",
    {
      messages: [{ role: "user", content: prompt }],
      requestId: crypto.randomUUID(),
      ...(foreignLookupRequest ? { foreignLookup: foreignLookupRequest } : {}),
    },
    { projectId: opts.projectId ?? null }
  );

  if (errorInfo) {
    throw new CitationRunError({
      code: errorInfo.code || `HTTP_${errorInfo.status ?? "ERR"}`,
      userMessage: errorInfo.message,
      isInvalidInput: errorInfo.isInvalidInput,
      isInsufficientCredits: errorInfo.isInsufficientCredits,
    });
  }

  handleRefundResponse(data);

  // 3a) M2B: grounded foreign metadata returned → merge + deterministic render.
  // User-supplied identity anchors win; grounded lookup fields fill the gaps;
  // anything ungrounded stays [חסר: …] via the existing renderer behavior.
  const fl = (data as { foreignLookup?: {
    identity?: { matched?: boolean };
    fields?: Record<string, string>;
  } } | null)?.foreignLookup;
  if (foreignLookupRequest && fl?.identity?.matched && fl.fields && Object.keys(fl.fields).length > 0) {
    const identity = toForeignIdentity(sourceType)!;
    const baseFields: Record<string, unknown> = { ...(fl.fields as Record<string, unknown>) };
    if (foreignDetection) {
      // Never overwrite what the user supplied; lookup only fills gaps.
      for (const [k, v] of Object.entries(foreignDetection.fields as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) baseFields[k] = v.trim();
      }
    }
    const detection = {
      sourceType,
      kind: identity.kind,
      jurisdiction: identity.jurisdiction,
      confidence: "deterministic" as const,
      fields: baseFields as unknown as ForeignFields,
    };
    const rendered = renderForeignDetection(detection);
    if (rendered && rendered.citation.trim()) {
      const missingSummary =
        rendered.missing.length > 0
          ? getMissingFieldsSummary(sourceType, rendered.missing)
          : null;
      const warningBits = [...rendered.warnings];
      if (missingSummary) warningBits.push(`חסרים פרטים לפי כלל 36.4: ${missingSummary}`);
      const hasMissing = rendered.missing.length > 0;
      const reply = hasMissing || warningBits.length
        ? `${rendered.citation}\n⚠️ ${warningBits.join(" ") || missingSummary}`
        : rendered.citation;
      return {
        reply,
        citation: rendered.citation,
        sourceType,
        sourceLabel: SOURCE_TYPE_LABELS[sourceType],
        fromVerifiedStore: false,
        status: hasMissing || warningBits.length ? "warning" : "valid",
        warningMsg: warningBits[0],
      };
    }
  }

  const reply = (data?.content as string) || "";
  if (!reply.trim()) {
    throw new CitationRunError({
      code: "EMPTY_RESPONSE",
      userMessage: "המנוע החזיר תשובה ריקה. נסו שוב.",
    });
  }

  // 4) Re-classify from the answer (database → published when פ"ד appears).
  let effectiveSourceType = sourceType;
  if (effectiveSourceType === "case_law_database" && /פ["״]ד\s+[א-ת]+/.test(reply)) {
    effectiveSourceType = "case_law_published";
  }

  const citation = extractCitationFromResponse(reply) || reply.trim();
  if (isFragment(citation)) {
    throw new CitationRunError({
      code: "FRAGMENT_RESPONSE",
      userMessage: "התוצאה שהתקבלה אינה אזכור שלם. נסו שוב או פרטו יותר.",
    });
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
    reply: finalReply,
    citation,
    sourceType: effectiveSourceType,
    sourceLabel: SOURCE_TYPE_LABELS[effectiveSourceType],
    fromVerifiedStore: false,
    status: hasMarker ? "warning" : "valid",
    warningMsg: hasMarker ? warningMsg || "חסרים פרטים – ראה סימון בתוצאה" : undefined,
  };
}
