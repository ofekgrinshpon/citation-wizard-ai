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
  host: "chat", pastedLocalDefersOpinionFormat: false, bookDefersToDeterministic: false,
  deterministicForeignRender: false, typedRequestBuilder: "chat_article_fields", articleIncompleteFallback: true,
  caseDisambiguation: false, groundedMerge: false, rejectEmptyCaseFields: false,
});
export const RUNNER_HOST: CitationHostCapabilities = Object.freeze({
  host: "runner", pastedLocalDefersOpinionFormat: true, bookDefersToDeterministic: true,
  deterministicForeignRender: true, typedRequestBuilder: "runner_foreign_lookup", articleIncompleteFallback: false,
  caseDisambiguation: true, groundedMerge: true, rejectEmptyCaseFields: true,
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
      status: warnings.length ? "warning" : "valid", warningMsg: caps.host === "runner" ? warnings[0] : pasted.local.warningMsg } };
  }
  const statutePrep = st && !p.isPinpoint ? prepareForeignStatute(st, p.input, { manual: p.manual }) : null;
  const unreported = st && !p.isPinpoint ? (renderUsUnreportedLocal(st, p.input) ?? renderUnpublishedLocal(st, p.input) ??
    renderPeriodicalLocal(st, p.input) ?? renderBookLocal(st, p.input, caps.bookDefersToDeterministic ? { deferToDeterministic: true } : undefined)) : null;
  if (unreported) return { origin: "unreported_local", resolution: { reply: unreported.reply, citation: unreported.citation, status: "warning", warningMsg: unreported.warningMsg } };
  if (caps.deterministicForeignRender && st && !p.isPinpoint && isForeignSourceType(st) && statutePrep?.outcome !== "mismatch") {
    const suppliedArticle = st === "foreign_journal_article";
    const identifiers = suppliedArticle ? extractWorkIdentifiers(p.input) : null;
    const hasIdentifier = !!(identifiers?.doi || identifiers?.sourceUrl || identifiers?.conflicts.length);
    const rendered = renderForeignCitation(hasIdentifier ? identifiers!.text : p.input);
    const k = rendered?.detection.kind;
    const crossed = (k === "case" && OPINION(rendered!.detection) || k === "unpublished_manuscript" || k === "thesis" || k === "newspaper" ||
      k === "journal_article" && !!(rendered!.detection.fields as { nonconsecutive?: boolean }).nonconsecutive) && st !== rendered!.detection.sourceType;
    if (rendered && rendered.missing.length === 0 && !crossed) {
      // Rendering is not identifier verification and never causes a billed lookup.
      const identifierWarning = hasIdentifier
        ? identifiers!.conflicts.length
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

interface FL { identity?: { matched?: boolean; jurisdiction?: "US" | "UK"; conflicts?: string[] }; fields?: Record<string, string>; disambiguation?: Array<{ jurisdiction: "US" | "UK"; label: string; url: string }> }
export type ResponseResolution =
  | { kind: "terminal"; origin: "safety" | "case" | "statute" | "disambiguation" | "article" | "merge"; resolution: CitationResolution }
  | { kind: "reject"; code: "EMPTY_RESPONSE" }
  /** Declared legacy handoff: host applies its own existing generic content handling. */
  | { kind: "legacy" };

/** Typed response resolver. Never switches the requested identity or source kind from a response. */
export function resolveCitationResponse(plan: TypedPlan, data: Record<string, unknown> | null, caps: CitationHostCapabilities): ResponseResolution {
  const contract = plan.evidence.pasted.contract;
  const fl = data?.foreignLookup as FL | undefined;
  const st = plan.sourceType;
  const label = st ? SOURCE_TYPE_LABELS[st] : undefined;
  const safety = readPastedCitationSafety(contract, data);
  if (safety) return { kind: "terminal", origin: "safety", resolution: { ...safety, status: "warning", pastedCitation: contract } };
  const caseResult = caps.caseDisambiguation && fl?.disambiguation?.length ? null : renderPastedCaseResponse(contract, plan.caseRequest, fl);
  if (caseResult) return { kind: "terminal", origin: "case", resolution: { ...caseResult, status: caseResult.warningMsg ? "warning" : "valid", pastedCitation: contract } };
  if (caps.rejectEmptyCaseFields && plan.caseRequest && fl?.identity?.matched && fl.fields &&
    !Object.keys(fl.fields).some(k => ["caseName", "court", "reporter", "year", "firstPage", "neutral", "docket"].includes(k))) return { kind: "reject", code: "EMPTY_RESPONSE" };
  if (plan.statutePrep?.request) {
    const r = renderForeignStatuteLookup(plan.statutePrep, fl);
    return { kind: "terminal", origin: "statute", resolution: { ...r, status: r.status === "warning" ? "warning" : "valid" } };
  }
  if (caps.caseDisambiguation && plan.foreignLookup && fl?.disambiguation && fl.disambiguation.length > 1) {
    const lines = fl.disambiguation.map((o, i) => `${i + 1}. ${o.label} (${o.jurisdiction === "UK" ? "בריטניה" : "ארה\"ב"}) — ${o.url}`);
    return { kind: "terminal", origin: "disambiguation", resolution: { reply: `נמצאו כמה פסקי דין אפשריים בשם זה. כדי לא לנחש, בחרו את הנכון והוסיפו את הערכאה או השנה:\n${lines.join("\n")}`,
      citation: "", sourceType: st ?? undefined, sourceLabel: label, status: "warning", warningMsg: "נדרשת בחירה בין כמה פסקי דין" } };
  }
  if (plan.articleRequest) {
    const article = renderForeignArticleLookup(plan.articleRequest, fl as ForeignArticleLookupResponse | undefined)
      ?? (caps.articleIncompleteFallback ? renderForeignArticleLookup(plan.articleRequest, { fields: {}, articleResolution: "incomplete" }) : null);
    if (article) return { kind: "terminal", origin: "article", resolution: { ...article, status: article.status === "warning" ? "warning" : "valid", sourceType: st ?? undefined, sourceLabel: label } };
  }
  if (caps.groundedMerge && st && plan.foreignLookup && fl?.fields && fl.identity?.matched && Object.keys(fl.fields).length > 0) {
    const req = plan.foreignLookup as { kind: ForeignSourceKind; jurisdiction: string; parsedFields: Record<string, string> };
    const resolvedJur: ForeignJurisdiction | null = req.kind === "case"
      ? (fl.identity?.jurisdiction ?? (req.jurisdiction === "US" || req.jurisdiction === "UK" ? req.jurisdiction : null))
      : ((req.jurisdiction as ForeignJurisdiction) ?? "OTHER");
    if (resolvedJur) {
      const effectiveType = req.kind === "case" ? toSourceType("case", resolvedJur) : st;
      const baseFields: Record<string, unknown> = { ...(fl.fields as Record<string, unknown>) };
      for (const [k, v] of Object.entries(req.parsedFields)) if (typeof v === "string" && v.trim()) baseFields[k] = v.trim();
      const rendered = renderForeignDetection({ sourceType: effectiveType, kind: req.kind, jurisdiction: resolvedJur, confidence: "deterministic", fields: baseFields as unknown as ForeignFields });
      if (rendered && rendered.citation.trim()) {
        const missingSummary = rendered.missing.length > 0 ? getMissingFieldsSummary(effectiveType, rendered.missing) : null;
        const warningBits = [...rendered.warnings];
        if (missingSummary) warningBits.push(`חסרים פרטים: ${missingSummary}`);
        const warn = rendered.missing.length > 0 || warningBits.length > 0;
        return { kind: "terminal", origin: "merge", resolution: { reply: warn ? `${rendered.citation}\n⚠️ ${warningBits.join(" ") || missingSummary}` : rendered.citation,
          citation: rendered.citation, sourceType: effectiveType, sourceLabel: SOURCE_TYPE_LABELS[effectiveType], status: warn ? "warning" : "valid", warningMsg: warningBits[0] } };
      }
    }
  }
  return { kind: "legacy" };
}
