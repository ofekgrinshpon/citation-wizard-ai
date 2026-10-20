/**
 * Batch B — shared pure citation planner and typed response resolver.
 *
 * Used by every existing citation host: Index (chat initial + manual
 * regeneration) directly, and BatchFootnoteBuilder / BibliographyGenerator
 * through runCitation. Pure: no network, storage, telemetry, billing,
 * request ids, retries or UI. Hosts keep owning all IO and stale handling.
 *
 * Host behaviour that currently differs is declared explicitly as
 * capabilities (see CHAT_HOST / RUNNER_HOST) — never silently unified.
 */
import { acceptCitationCompletion } from "@/lib/citationCompletion";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { renderForeignCitation, renderForeignDetection } from "@/data/bluebook";
import { detectForeignSource, type ForeignDetection } from "@/data/bluebook/extract";
import { isForeignSourceType, toForeignIdentity, toSourceType, type ForeignFields, type ForeignJurisdiction, type ForeignSourceKind } from "@/data/bluebook/types";
import { getMissingFieldsSummary } from "@/lib/citationValidation";
import { parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";
import { extractWorkIdentifiers } from "../../supabase/functions/_shared/workIdentifiers";
import type { CitationManualChoice, PastedCitationContract } from "../../supabase/functions/_shared/pastedCitation";
import { articleRequestFields, buildForeignArticleRequest, renderForeignArticleLookup, type ForeignArticleLookupResponse } from "@/lib/foreignArticleAdapter";
import { prepareForeignStatute, renderForeignStatuteLookup, renderStatuteLocal, type StatutePreparation } from "@/lib/foreignStatuteAdapter";
import { renderUsUnreportedLocal } from "@/lib/usUnreportedLocal";
import { renderUnpublishedLocal } from "@/lib/unpublishedWorkLocal";
import { renderPeriodicalLocal } from "@/lib/periodicalLocal";
import { renderBookLocal } from "@/lib/bookLocal";
import { preparePastedCitation, pastedCaseRequest, readPastedCitationSafety, renderPastedCaseResponse } from "@/lib/pastedCitationAdapter";

/** Explicit, declared differences between hosts. Batch C may reconcile them. */
export interface CitationHostCapabilities {
  host: "chat" | "runner";
  /** Pasted local render waits for the opinion-format (US unreported) formatter. */
  pastedLocalDefersOpinionFormat: boolean;
  /** Book formatter defers complete inputs to the deterministic renderer. */
  bookDefersToDeterministic: boolean;
  /** Generic deterministic foreign renderer runs before statute local. */
  deterministicForeignRender: boolean;
  /** Typed request builder: chat article fields only vs runner planForeignLookup (article/book/chapter/case). */
  typedRequestBuilder: "chat_article_fields" | "runner_foreign_lookup";
  /** Article typed response falls back to an "incomplete" render when absent. */
  articleIncompleteFallback: boolean;
  /** Multiple case candidates are surfaced as a disambiguation choice. */
  caseDisambiguation: boolean;
  /** Matched typed fields (book/chapter/case) merge into the deterministic renderer. */
  groundedMerge: boolean;
  /** Matched case response without identity fields is rejected as unusable. */
  rejectEmptyCaseFields: boolean;
}

export const CHAT_HOST: CitationHostCapabilities = Object.freeze({
  host: "chat", pastedLocalDefersOpinionFormat: true, bookDefersToDeterministic: false,
  deterministicForeignRender: true, typedRequestBuilder: "chat_article_fields", articleIncompleteFallback: true,
  caseDisambiguation: true, groundedMerge: true, rejectEmptyCaseFields: false,
});
export const RUNNER_HOST: CitationHostCapabilities = Object.freeze({
  host: "runner", pastedLocalDefersOpinionFormat: true, bookDefersToDeterministic: false,
  deterministicForeignRender: true, typedRequestBuilder: "runner_foreign_lookup", articleIncompleteFallback: true,
  caseDisambiguation: true, groundedMerge: true, rejectEmptyCaseFields: false,
});

export interface CitationResolution {
  reply: string;
  citation: string;
  status: "valid" | "warning";
  warningMsg?: string;
  /** Undefined → host keeps its own effective source type/label. */
  sourceType?: SourceType;
  sourceLabel?: string;
  pastedCitation?: PastedCitationContract;
  completion?: ReturnType<typeof acceptCitationCompletion>;
}
export type LocalOrigin = "preserve" | "pasted_local" | "unreported_local" | "deterministic" | "statute_local";

export interface CitationEvidence { pasted: ReturnType<typeof preparePastedCitation> }

/** Phase 1 — evidence and manual conflicts, before any cache or classifier. */
export function planCitationEvidence(rawInput: string, manual: CitationManualChoice | null): CitationEvidence & { preserve: CitationResolution | null } {
  const pasted = preparePastedCitation(rawInput, manual);
  const preserve = pasted.local && pasted.contract.route === "preserve"
    ? { ...pasted.local, status: "warning" as const, pastedCitation: pasted.contract } : null;
  return { pasted, preserve };
}

export interface LocalPlanInput {
  evidence: CitationEvidence;
  /** Effective source type, or null when the host has none (free chat). */
  sourceType: SourceType | null;
  input: string;
  isPinpoint: boolean;
  manual: boolean;
}

const OPINION = (d: ForeignDetection | null | undefined) => !!(d?.fields as { opinionFormat?: string } | undefined)?.opinionFormat;

/** Phase 2 — terminal local outcomes (render or preserve). Null → continue to typed planning. */
export function planLocalCitation(p: LocalPlanInput, caps: CitationHostCapabilities): { origin: LocalOrigin; resolution: CitationResolution } | { origin: null; statutePrep: StatutePreparation | null } {
  const { pasted } = p.evidence;
  const st = p.sourceType;
  if (pasted.local && !(caps.pastedLocalDefersOpinionFormat && OPINION(pasted.detection))) {
    const warnings = pasted.detection ? renderForeignDetection(pasted.detection)?.warnings ?? [] : [];
    return { origin: "pasted_local", resolution: { ...pasted.local, pastedCitation: pasted.contract,
      status: "warning", warningMsg: pasted.local.warningMsg } };
  }
  const statutePrep = st && !p.isPinpoint ? prepareForeignStatute(st, p.input, { manual: p.manual }) : null;
  const unreported = st && !p.isPinpoint ? (renderUsUnreportedLocal(st, p.input) ?? renderUnpublishedLocal(st, p.input) ??
    renderPeriodicalLocal(st, p.input) ?? renderBookLocal(st, p.input, caps.bookDefersToDeterministic ? { deferToDeterministic: true } : undefined)) : null;
  if (unreported) return { origin: "unreported_local", resolution: { reply: unreported.reply, citation: unreported.citation, status: "warning", warningMsg: unreported.warningMsg } };
  if (caps.deterministicForeignRender && st && !p.isPinpoint && isForeignSourceType(st) && statutePrep?.outcome !== "mismatch") {
    const suppliedArticle = st === "foreign_journal_article";
    const identifiers = suppliedArticle ? extractWorkIdentifiers(p.input) : null;
    const hasIdentifier = !!(identifiers?.doi || identifiers?.sourceUrl || identifiers?.conflicts.length);
    const rendered = renderForeignCitation(hasIdentifier && identifiers ? identifiers.text : p.input);
    const k = rendered?.detection.kind;
    const crossed = (k === "case" && OPINION(rendered?.detection) || k === "unpublished_manuscript" || k === "thesis" || k === "newspaper" ||
      k === "journal_article" && !!(rendered?.detection.fields as { nonconsecutive?: boolean }).nonconsecutive) && st !== rendered?.detection.sourceType;
    if (rendered && rendered.missing.length === 0 && !crossed) {
      // Rendering is not identifier verification and never causes a billed lookup.
      const identifierWarning = hasIdentifier
        ? identifiers?.conflicts.length
          ? "נמצאו מזהים סותרים או קישור שאינו נתמך; לא אומתה התאמתם לפרטי המאמר שסיפקתם."
          : "לא אומתה התאמת ה־DOI או הקישור לפרטי המאמר שסיפקתם."
        : undefined;
      const warn = !!identifierWarning || rendered.warnings.length > 0;
      return { origin: "deterministic", resolution: {
        reply: warn ? `${rendered.citation}\n⚠️ ${[identifierWarning, ...rendered.warnings].filter(Boolean).join(" ")}` : rendered.citation,
        citation: rendered.citation, sourceType: rendered.detection.sourceType, sourceLabel: SOURCE_TYPE_LABELS[rendered.detection.sourceType],
        status: warn ? "warning" : "valid", warningMsg: identifierWarning ?? rendered.warnings[0] } };
    }
  }
  if (statutePrep && statutePrep.outcome !== "lookup") {
    const r = renderStatuteLocal(statutePrep);
    return { origin: "statute_local", resolution: { ...r, status: r.status === "warning" ? "warning" : "valid" } };
  }
  return { origin: null, statutePrep };
}

/** "X v. Y" shape (any common-law jurisdiction). */
const FOREIGN_CASE_SHAPE = /[A-Za-z][^\n]*?\s+v(?:s)?\.?\s+[A-Za-z]/;
export function extractForeignCaseName(raw: string): string | null {
  const m = raw.match(/^\s*(.+?\s+v(?:s)?\.?\s+.+?)(?:\s*[,(\[]\s*(?:\d|\[)|\s*\(|\s*\[|$)/);
  return m ? m[1].trim().replace(/[,\s]+$/, "") : null;
}
/** A case-shaped input without an explicit US/UK anchor goes out as UNKNOWN. */
export function planForeignLookup(sourceType: SourceType, raw: string, detection: ForeignDetection | null): { kind: ForeignSourceKind; jurisdiction: "US" | "UK" | "OTHER" | "UNKNOWN" } | null {
  const identity = toForeignIdentity(sourceType);
  const caseShaped = FOREIGN_CASE_SHAPE.test(raw);
  if (identity?.kind === "statute") return identity.jurisdiction === "US" || identity.jurisdiction === "UK" ? { kind: "statute", jurisdiction: identity.jurisdiction } : null;
  if (detection?.kind === "statute") return detection.jurisdiction === "US" || detection.jurisdiction === "UK" ? { kind: "statute", jurisdiction: detection.jurisdiction } : null;
  if (detection && detection.kind === "case" && (detection.jurisdiction === "US" || detection.jurisdiction === "UK")) return { kind: "case", jurisdiction: detection.jurisdiction };
  if (identity && ["journal_article", "book", "book_chapter"].includes(identity.kind)) return { kind: identity.kind, jurisdiction: identity.jurisdiction };
  if (identity?.kind === "case" || ((sourceType === "foreign") && caseShaped)) {
    if (!caseShaped) return null;
    if (identity?.kind === "case" && identity.jurisdiction === "US" && /\b(Cir\.|U\.S\.|F\.\s?(?:2d|3d|4th|Supp)|S\.D\.N\.Y\.|D\.\s?[A-Z])/.test(raw)) return { kind: "case", jurisdiction: "US" };
    if (/\b(UKSC|UKHL|EWCA|EWHC|UKPC|WLR|All ER)\b/.test(raw)) return { kind: "case", jurisdiction: "UK" };
    return { kind: "case", jurisdiction: "UNKNOWN" };
  }
  return null;
}

export interface TypedPlan {
  kind: "typed" | "legacy";
  evidence: CitationEvidence;
  sourceType: SourceType | null;
  statutePrep: StatutePreparation | null;
  caseRequest: ReturnType<typeof pastedCaseRequest>;
  articleRequest: { parsedFields: Record<string, string> } | null;
  /** The single foreignLookup body field (case > statute > article/other). */
  foreignLookup: Record<string, unknown> | null;
  /** Chat only: article rawInput field from articleRequestFields. */
  extraBody: Record<string, unknown>;
}

/** Phase 3 — the existing bound typed request, or an explicitly declared legacy handoff. */
export function planTypedRequest(p: LocalPlanInput & { statutePrep: StatutePreparation | null; canonicalRaw: string }, caps: CitationHostCapabilities): TypedPlan {
  const { pasted } = p.evidence;
  const st = p.sourceType;
  let foreignLookup: Record<string, unknown> | null = null;
  let articleRequest: TypedPlan["articleRequest"] = null;
  let extraBody: Record<string, unknown> = {};
  if (caps.typedRequestBuilder === "chat_article_fields") {
    const fields = articleRequestFields(st ?? undefined, st ? p.input : undefined);
    extraBody = { ...fields };
    if (fields.foreignLookup) { foreignLookup = { ...fields.foreignLookup }; articleRequest = fields.foreignLookup; }
    if (p.statutePrep?.request) foreignLookup = { ...p.statutePrep.request };
  } else if (p.statutePrep?.request) {
    foreignLookup = { ...p.statutePrep.request };
  } else if (st && !p.isPinpoint && isForeignSourceType(st)) {
    const detection = detectForeignSource(p.input);
    const plan = planForeignLookup(st, p.input, detection);
    if (plan && plan.kind !== "statute") {
      const parsedFields: Record<string, string> = plan.kind === "journal_article" ? parseForeignArticleInput(p.input) : {};
      if (detection) for (const [k, v] of Object.entries(detection.fields as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) parsedFields[k] = v.trim();
        else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) parsedFields[k] = v.join(", ");
      }
      if (plan.kind === "case" && !parsedFields.caseName) { const name = extractForeignCaseName(p.input); if (name) parsedFields.caseName = name; }
      foreignLookup = plan.kind === "journal_article" ? { ...buildForeignArticleRequest(p.input) }
        : { enabled: true, kind: plan.kind, jurisdiction: plan.jurisdiction, rawInput: p.input, parsedFields };
      if (plan.kind === "journal_article") articleRequest = foreignLookup as { parsedFields: Record<string, string> };
    }
  }
  const caseRequest = pastedCaseRequest(p.canonicalRaw, pasted.contract);
  if (caseRequest) foreignLookup = caseRequest;
  if (caseRequest && caps.typedRequestBuilder === "runner_foreign_lookup") articleRequest = null;
  const typed = !!(foreignLookup || p.statutePrep?.request);
  return { kind: typed ? "typed" : "legacy", evidence: p.evidence, sourceType: st, statutePrep: p.statutePrep, caseRequest, articleRequest, foreignLookup, extraBody };
}

export type ResponseResolution =
  | { kind: "terminal"; origin: "safety" | "case" | "statute" | "disambiguation" | "article" | "merge"; resolution: CitationResolution }
  | { kind: "reject"; code: "EMPTY_RESPONSE" }
  | { kind: "legacy" };

/** One terminal acceptance path for every existing typed request; legacy requests alone hand off. */
export function resolveCitationResponse(plan: TypedPlan, data: Record<string, unknown> | null, _caps: CitationHostCapabilities): ResponseResolution {
  const contract = plan.evidence.pasted.contract;
  const safety = readPastedCitationSafety(contract, data);
  if (safety) return { kind: "terminal", origin: "safety", resolution: { ...safety, status: "warning", pastedCitation: contract } };
  if (plan.kind === "legacy" || !plan.foreignLookup) return { kind: "legacy" };
  const req = plan.foreignLookup;
  const response = data?.foreignLookup;
  const accepted = acceptCitationCompletion(req, contract.rawInput, response);
  const st = plan.sourceType;
  const warnings: string[] = [];
  const messages = {
    binding: "תשובת החיפוש סותרת את הקלט, סוג המקור או השיפוט; הקלט נשמר ללא השלמה.",
    malformed: "תשובת החיפוש אינה בפורמט נתמך; נשמרו רק הפרטים שסופקו.",
    unavailable: "חיפוש פרטי המקור לא היה זמין; נשמרו רק הפרטים שסופקו.",
    identity: "לא אומתה התאמת המקור לפרטים שסופקו או נמצאו פרטים סותרים; נשמרו רק הפרטים שסופקו.",
    ambiguous: "נדרשת בחירה בין כמה פסקי דין",
  };
  if (accepted.reason) warnings.push(messages[accepted.reason]);
  if (accepted.quarantined.length) warnings.push("פרטים סותרים או ללא ראיות מספקות לא שולבו: " + accepted.quarantined.join(", ") + ".");
  const fl = response && typeof response === "object" ? response as Record<string, unknown> : {};
  if (accepted.reason === "ambiguous" && req.kind === "case" && Array.isArray(fl.disambiguation)) {
    const choices = fl.disambiguation.filter((v): v is { jurisdiction: "US" | "UK"; label: string; url: string } => {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;
      if (!["US", "UK"].includes(String(o.jurisdiction)) || typeof o.label !== "string" || !o.label.trim() || typeof o.url !== "string") return false;
      try { return ["https:", "http:"].includes(new URL(o.url).protocol); } catch { return false; }
    });
    if (choices.length > 1) return { kind: "terminal", origin: "disambiguation", resolution: {
      citation: "", reply: `נמצאו כמה פסקי דין אפשריים בשם זה. כדי לא לנחש, בחרו את הנכון והוסיפו את הערכאה או השנה:\n${choices.slice(0, 5).map((o, i) => escapeCitationLiteral(`${i + 1}. ${o.label} (${o.jurisdiction}) — ${o.url}`)).join("\n")}`,
      status: "warning", warningMsg: messages.ambiguous, pastedCitation: contract,
    } };
  }
  const supplied = req.parsedFields && typeof req.parsedFields === "object" ? req.parsedFields as Record<string, string> : {};
  let rendered: { citation: string; reply?: string; missing?: string[]; warnings?: string[] } | null = null;
  const kind = req.kind as ForeignSourceKind;
  const jur = accepted.jurisdiction ?? (req.jurisdiction === "US" || req.jurisdiction === "UK" ? req.jurisdiction : "OTHER");
  const effectiveType = st ?? toSourceType(kind, jur);
  if (kind === "statute" && plan.statutePrep) {
    rendered = renderForeignStatuteLookup(plan.statutePrep, { ...fl, fields: accepted.fields,
      identity: { matched: accepted.identityConfirmed, jurisdiction: jur, conflicts: [] } });
  } else if (kind === "journal_article" && plan.articleRequest) {
    // A sanitized response never replaces supplied authors (including abbreviations).
    rendered = renderForeignArticleLookup(plan.articleRequest, { fields: accepted.fields, identity: { matched: accepted.identityConfirmed, conflicts: [] }, articleResolution: "incomplete" });
  } else if (accepted.identityConfirmed) {
    rendered = renderForeignDetection({ kind, jurisdiction: jur, sourceType: effectiveType,
      confidence: "deterministic", fields: { ...accepted.fields, ...supplied } as ForeignFields });
  }
  if (accepted.identityConfirmed && Array.isArray((fl.identity as { conflicts?: unknown } | undefined)?.conflicts) && ((fl.identity as { conflicts: unknown[] }).conflicts.length)) warnings.push("נמצאו פרטי פרסום סותרים; נשמרו רק השלמות תואמות.");
  if (rendered?.warnings) warnings.push(...rendered.warnings);
  if (rendered?.missing?.length) warnings.push(`חסרים פרטים: ${getMissingFieldsSummary(effectiveType, rendered.missing)}`);
  if (rendered?.reply?.includes("⚠️")) warnings.push(rendered.reply.split("⚠️").slice(1).join(" ").trim());
  // Unknown spans remain in the evidence contract and are never lost through partial rendering.
  const citation = rendered?.citation.trim() || escapeCitationLiteral(contract.rawInput);
  const bits = [...new Set(warnings.filter(Boolean))];
  return { kind: "terminal", origin: kind === "case" ? "case" : kind === "statute" ? "statute" : kind === "journal_article" ? "article" : "merge", resolution: {
    citation, reply: citation + (bits.length ? `\n⚠️ ${bits.join(" ")}` : ""),
    status: bits.length ? "warning" : "valid", warningMsg: bits[0],
    sourceType: effectiveType, sourceLabel: SOURCE_TYPE_LABELS[effectiveType], pastedCitation: contract,
    completion: accepted,
  } };
}
