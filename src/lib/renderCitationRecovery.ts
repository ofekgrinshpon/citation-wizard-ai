/** Recovery rendering is deliberately pure: no classifier, network, storage,
 * verification, telemetry, refund handling or normal citation-run callbacks. */
import type { SourceType } from "@/data/abbreviations";
import { renderForeignDetection, stripCitationMarkers } from "@/data/bluebook";
import { toSourceType, type ForeignFields, type ForeignJurisdiction, type ForeignSourceKind } from "@/data/bluebook/types";
import { renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { renderForeignStatuteLookup, statutePreparationFromRequest } from "@/lib/foreignStatuteAdapter";
import type { CitationRecoveryRecord } from "@/lib/citationRecoveryApi";
import { isAuthenticatedRecoveryRecord } from "@/lib/citationRecoveryApi";
import { CITATION_FIELD_KEYS } from "../../supabase/functions/_shared/citationRecovery";
import { guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import { hasBookFinalFrame, readBookFinal } from "../../supabase/functions/_shared/citationPure/bookFinal.ts";
import { citationRecoveryResult } from "../../supabase/functions/_shared/citationRecovery.ts";
import { planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, RUNNER_HOST, type TypedPlan, type CitationResolution } from "@/lib/citationPlanner";

export const RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_TEXT_LIMIT = 50_000;
const FIELD_LIMIT = 4_000;
const FIELD_NAMES = new Set<string>(CITATION_FIELD_KEYS);
const KINDS = new Set<ForeignSourceKind>(["case", "constitution", "statute", "book", "journal_article", "book_chapter", "internet"]);

export interface RenderedCitationRecovery {
  /** Safe to render only as React text / the existing marker-only component. */
  formattedOutput: string;
  plainText: string;
  sourceType: SourceType;
  structured: boolean;
  truncated: boolean;
  warning: string | null;
  /** Transient only; never persisted or treated as provider evidence. */
  completion?: CitationResolution["completion"];
}

/** Strip invisible execution/control and direction-override characters. HTML is
 * left as literal text, never interpreted, and no links are activated. */
export function recoveryPlainText(value: unknown, limit = RECOVERY_TEXT_LIMIT): string {
  return typeof value === "string"
    // eslint-disable-next-line no-control-regex
    ? value.slice(0, limit).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "")
    : "";
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function fields(value: unknown): Record<string, string> | null {
  const input = object(value);
  if (!input || Object.keys(input).length > 64) return null;
  const result: Record<string, string> = Object.create(null);
  for (const [key, entry] of Object.entries(input)) {
    if (!FIELD_NAMES.has(key) || typeof entry !== "string") return null;
    if (!entry.trim()) continue;
    // Never truncate an identity field and then pass it off as the original.
    if (entry.length > FIELD_LIMIT) return null;
    result[key] = recoveryPlainText(entry, FIELD_LIMIT).trim();
  }
  return result;
}

/** Accepted UK wire aliases carry the same identity as the renderer's fields.
 * Normalize each side before merging so retained user aliases still win. */
function ukFields(input: Record<string, string>): Record<string, string> | null {
  if ((input.ukSeries && input.reporter && input.ukSeries !== input.reporter) ||
      (input.ukVolume && input.reporterVolume && input.ukVolume !== input.reporterVolume)) return null;
  return { ...input, ...(input.ukSeries ? { reporter: input.ukSeries } : {}),
    ...(input.ukVolume ? { reporterVolume: input.ukVolume } : {}) };
}

/** The claim's creation time, never a later read/replay, starts the 24h window. */
export function citationRecoveryDeadline(record: Pick<CitationRecoveryRecord, "createdAt" | "expiresAt">): number | null {
  const created = Date.parse(record.createdAt);
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(created) && Number.isFinite(expires) && expires >= created
    ? Math.min(expires, created + RECOVERY_RETENTION_MS) : null;
}

export function citationRecoveryExpired(record: CitationRecoveryRecord, now = Date.now()): boolean {
  const deadline = citationRecoveryDeadline(record);
  return record.availability === "expired" || (deadline !== null && now >= deadline);
}

function originalRecoveryInput(record: CitationRecoveryRecord): string {
  if (!record.input) return "";
  const foreign = object(record.input.foreignLookup);
  const raw = record.input.rawInput || foreign?.rawInput;
  if (typeof raw === "string" && raw.trim()) return raw;
  return record.input.messages?.filter((message) => message.role === "user")
    .map((message) => message.content).join("\n\n") ?? "";
}

export function recoveryInputText(record: CitationRecoveryRecord): string {
  return recoveryPlainText(originalRecoveryInput(record));
}

export function recoveryInputTruncated(record: CitationRecoveryRecord): boolean {
  return originalRecoveryInput(record).length > RECOVERY_TEXT_LIMIT;
}

function output(text: string, sourceType: SourceType, structured: boolean, warning: string | null = null): RenderedCitationRecovery | null {
  const clean = recoveryPlainText(text);
  if (!clean.trim()) return null;
  const truncated = text.length > RECOVERY_TEXT_LIMIT;
  return { formattedOutput: clean, plainText: structured ? stripCitationMarkers(clean) : clean,
    sourceType, structured, truncated,
    warning: truncated ? "התוצאה ארוכה ממגבלת התצוגה. מוצג חלק ממנה בלבד ולא ניתן לשמור עותק חלקי בהיסטוריה." : warning };
}

/** Rebuild structured-only results solely from the retained original context.
 * Rendering completion is not legal verification or proof of citation quality. */
export function renderCitationRecovery(record: CitationRecoveryRecord, now = Date.now()): RenderedCitationRecovery | null {
  if (record.status !== "succeeded" || record.availability !== "available" ||
      citationRecoveryDeadline(record) === null || citationRecoveryExpired(record, now) || !record.result) return null;
  const request = object(record.input?.foreignLookup);
  const result = object(record.result.foreignLookup);
  // Existing retained extraction envelopes with raw binding use the same strict
  // terminal resolver as initial/retried requests. Older unbound records below
  // remain readable, never dispatched or promoted to verified identity.
  if (request && typeof request.rawInput === "string" && ["case", "statute", "journal_article", "book", "book_chapter"].includes(String(request.kind))) {
    const raw = originalRecoveryInput(record);
    if (!fields(request.parsedFields)) return null;
    const jur = request.jurisdiction === "US" || request.jurisdiction === "UK" ? request.jurisdiction : "OTHER";
    const sourceType = toSourceType(request.kind as ForeignSourceKind, jur);
    if (request.kind === "book" || request.kind === "book_chapter") {
      const preserve = () => {
        const warning = "הקלט המקורי, סוג המקור או הבחירה הידנית אינם תואמים לבקשה שנשמרה; הקלט נשמר ללא השלמה.";
        return output(`${escapeCitationLiteral(raw)}\n⚠️ ${warning}`, sourceType, true, warning);
      };
      // Recompute from the same original text, never retained localFields or
      // returned provider fields. The existing server guard checks wrappers,
      // manual constraints and the unchanged raw-bound field allowlist.
      const bound = guardPastedCitationRequest({ messages: record.input?.messages ?? [], rawInput: raw, foreignLookup: request });
      if (request.rawInput !== raw || bound.rawInput !== raw || bound.route === "preserve") return preserve();
      const evidence = planCitationEvidence(raw, bound.manualChoice);
      if (evidence.preserve) return preserve();
      const input = { evidence, sourceType, input: raw, isPinpoint: false, manual: !!bound.manualChoice };
      const local = planLocalCitation(input, RUNNER_HOST);
      if ("resolution" in local) return preserve();
      const rebuilt = planTypedRequest({ ...input, canonicalRaw: raw, statutePrep: local.statutePrep }, RUNNER_HOST);
      const projected = fields(rebuilt.foreignLookup?.parsedFields);
      const retained = fields(request.parsedFields);
      if (rebuilt.kind !== "typed" || rebuilt.foreignLookup?.kind !== request.kind || rebuilt.foreignLookup?.jurisdiction !== request.jurisdiction ||
          !projected || !retained || Object.keys(projected).length !== Object.keys(retained).length ||
          Object.entries(projected).some(([key, value]) => retained[key] !== value)) return preserve();
      // Only versioned server-owned content read from retention may replay.
      // Binding runs first; plain/legacy content never bypasses strict fields.
      if (hasBookFinalFrame(record.result.content)) {
        const valid = citationRecoveryResult(record.result);
        const foreign = valid?.foreignLookup;
        const replay = isAuthenticatedRecoveryRecord(record) && valid && record.input && foreign?.kind === request.kind && foreign?.jurisdiction === request.jurisdiction
          ? readBookFinal(valid.content, record.input, record.requestId) : null;
        if (!replay) return preserve();
        return output(replay.reply, sourceType, true, replay.warnings[0] ?? null);
      }
      // Keep the retained operation and request identity; only locally parsed
      // fields/spans are rebuilt. This is resolution, not dispatch or retry.
      const resolved = resolveCitationResponse({ ...rebuilt, foreignLookup: request }, { ...record.result }, RUNNER_HOST);
      if (resolved.kind !== "terminal") return preserve();
      const rendered = output(resolved.resolution.reply, sourceType, true, resolved.resolution.warningMsg ?? null);
      return rendered ? { ...rendered, completion: resolved.resolution.completion } : null;
    }
    const prep = request.kind === "statute" ? statutePreparationFromRequest(request) : null;
    const plan: TypedPlan = { kind: "typed", evidence: planCitationEvidence(raw, null), sourceType,
      statutePrep: prep, caseRequest: null, articleRequest: request.kind === "journal_article" ? { parsedFields: fields(request.parsedFields) ?? {} } : null,
      foreignLookup: request, extraBody: {} };
    const resolved = resolveCitationResponse(plan, { ...record.result }, RUNNER_HOST);
    if (resolved.kind === "terminal") return output(resolved.resolution.reply, resolved.resolution.sourceType ?? sourceType, true, resolved.resolution.warningMsg ?? null);
  }
  if (request && result) {
    const parsedFields = fields(request.parsedFields);
    const resultFields = fields(result.fields);
    const identity = object(result.identity);
    if (Array.isArray(result.disambiguation) && result.disambiguation.length > 1) {
      const choices = result.disambiguation.slice(0, 10).map((entry, index) => {
        const choice = object(entry);
        return `${index + 1}. ${recoveryPlainText(choice?.label, FIELD_LIMIT)} (${recoveryPlainText(choice?.jurisdiction, 20)}) ${recoveryPlainText(choice?.url, FIELD_LIMIT)}`;
      });
      return output(`נמצאו כמה מקורות אפשריים. נדרשת בחירה ובדיקה לפני שימוש:\n${choices.join("\n")}`, "foreign", false, "נדרשת בחירה בין מקורות; זו אינה תוצאה מאומתת.");
    }
    if (parsedFields && resultFields && request.kind === "journal_article") {
      const resolution = ["resolved", "incomplete", "conflict"].includes(String(result.articleResolution))
        ? result.articleResolution as "resolved" | "incomplete" | "conflict" : undefined;
      const article = renderForeignArticleLookup({ parsedFields }, {
        fields: resultFields, articleResolution: resolution,
        identity: { matched: identity?.matched === true,
          conflicts: Array.isArray(identity?.conflicts) ? identity.conflicts.slice(0, 32).map((entry) => recoveryPlainText(entry, FIELD_LIMIT)) : [] },
      });
      if (article) return output(article.reply, "foreign_journal_article", true, article.warningMsg ?? null);
    }
    if (request.kind === "statute") {
      // Same terminal adapter as the live paths: merge only from a versioned,
      // matched, conflict-free same-jurisdiction result; otherwise supplied input + warning.
      const prep = parsedFields ? statutePreparationFromRequest({ ...request, parsedFields }) : null;
      if (!prep) return null;
      const statute = renderForeignStatuteLookup(prep, result.statuteResponseVersion === 1 && resultFields ? { ...result, fields: resultFields } : null);
      return output(statute.reply, statute.sourceType, true, statute.warningMsg ?? null);
    }
    const kind = request.kind as ForeignSourceKind;
    if (parsedFields && resultFields && KINDS.has(kind) && identity?.matched === true && Object.keys(resultFields).length) {
      const jurisdiction = kind === "case" ? identity?.jurisdiction ?? request.jurisdiction : request.jurisdiction;
      if (["US", "UK", "OTHER"].includes(String(jurisdiction)) && !(kind === "case" && jurisdiction === "OTHER")) {
        const originalFields = kind === "case" && jurisdiction === "UK" ? ukFields(parsedFields) : parsedFields;
        const returnedFields = kind === "case" && jurisdiction === "UK" ? ukFields(resultFields) : resultFields;
        if (!originalFields || !returnedFields) return null;
        const sourceType = toSourceType(kind, jurisdiction as ForeignJurisdiction);
        const rendered = renderForeignDetection({ kind, jurisdiction: jurisdiction as ForeignJurisdiction, sourceType,
          confidence: "deterministic", fields: { ...returnedFields, ...originalFields } as ForeignFields });
        if (rendered) {
          const warnings = [...rendered.warnings, ...(rendered.missing.length ? ["חסרים פרטים באזכור; יש להשלים ולבדוק לפני שימוש."] : [])];
          if (Array.isArray(identity?.conflicts) && identity.conflicts.length) warnings.push("נמצאו פרטים סותרים; יש לבדוק את המקור לפני שימוש.");
          return output(`${rendered.citation}${warnings.length ? `\n⚠️ ${warnings.join(" ")}` : ""}`, sourceType, true, warnings[0] ?? null);
        }
      }
    }
  }
  // Preserve a generic retained response as plain text. Do not classify it,
  // send it for verification, or trust HTTP success as a quality signal.
  return typeof record.result.content === "string" ? output(record.result.content, "unknown", false) : null;
}
