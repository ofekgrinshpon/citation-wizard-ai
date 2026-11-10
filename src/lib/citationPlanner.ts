/**
 * Batch B — shared pure citation planner and typed response resolver.
 *
 * Used by every existing citation host: Index (chat initial + manual
 * regeneration) directly, and BibliographyGenerator / Word review
 * through runCitation. Pure: no network, storage, telemetry, billing,
 * request ids, retries or UI. Hosts keep owning all IO and stale handling.
 *
 * Hosts retain their IO/context ownership; existing typed planning is shared.
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
import { eligibleBookCompletion, resolveBookCompletion } from "../../supabase/functions/_shared/citationPure/bookFinal.ts";
import { preparePastedCitation, pastedCaseRequest, readPastedCitationSafety, renderPastedCaseResponse } from "@/lib/pastedCitationAdapter";
import { suppliedLookupFieldsMatch } from "../../supabase/functions/_shared/pastedCitation";
import { DISABLED_RULEPACK_WARNING, rulepackCapability, rulepackLookupEligible } from "../../supabase/functions/_shared/citationPure/rulepack.ts";
import { readLocationChoice } from "../../supabase/functions/_shared/citationPure/caseLocations.ts";
import { adoptVerifiedCasing } from "../../supabase/functions/_shared/citationPure/caseNameCase.ts";
import { bindFreeformResponseFields, prepareFreeformHandoff, prepareFreeformModelHandoff, type FreeformHandoff, type FreeformSearchRequest } from "../../supabase/functions/_shared/citationPure/freeformInterpret.ts";
import { buildCountryCaseChoice, buildForeignCaseChoice, decisionChoiceReply, locationChoiceReply, prepareChoiceSelection, type ForeignCaseChoice } from "@/lib/foreignCaseChoice";
import { acceptCountryResponse, countryCues, type CountryLookupRequest } from "../../supabase/functions/_shared/citationPure/countryLookup.ts";
import { buildCountryQuestion, countryQuestionReply, type CountryQuestion } from "@/lib/countryQuestion";

/** Local rendering controls; only host identity differs after bounded C2 parity. */
export interface CitationHostCapabilities {
  /** "word": the runner inside the Word footnote review, which can show record-bound choices. */
  host: "chat" | "runner" | "word";
  /** Pasted local render waits for the opinion-format (US unreported) formatter. */
  pastedLocalDefersOpinionFormat: boolean;
  /** Book formatter defers complete inputs to the deterministic renderer. */
  bookDefersToDeterministic: boolean;
  /** Generic deterministic foreign renderer runs before statute local. */
  deterministicForeignRender: boolean;
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
  deterministicForeignRender: true, articleIncompleteFallback: true,
  caseDisambiguation: true, groundedMerge: true, rejectEmptyCaseFields: false,
});
export const RUNNER_HOST: CitationHostCapabilities = Object.freeze({
  host: "runner", pastedLocalDefersOpinionFormat: true, bookDefersToDeterministic: false,
  deterministicForeignRender: true, articleIncompleteFallback: true,
  caseDisambiguation: true, groundedMerge: true, rejectEmptyCaseFields: false,
});
/** Same rendering as the runner; only adds record-bound choice buttons (Word review cards). */
export const WORD_HOST: CitationHostCapabilities = Object.freeze({ ...RUNNER_HOST, host: "word" });
/** Hosts that can show and apply a record-bound foreign case choice in memory. */
const offersRecordChoice = (caps: CitationHostCapabilities) => caps.host === "chat" || caps.host === "word";

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
  /** Chat only: record-bound foreign case choice (in memory, never persisted). */
  foreignChoice?: ForeignCaseChoice;
  /** Chat only: ask which country a case is from instead of guessing (in memory, input-bound). */
  countryQuestion?: CountryQuestion;
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

/**
 * Free-form Latin book/article text that the structured detector did not take.
 * Hebrew, manual choices and an already-structured citation stay on the existing route.
 */
function freeformDecision(p: LocalPlanInput): FreeformHandoff | null {
  if (p.manual || p.isPinpoint) return null;
  if (p.evidence.pasted.contract.route === "israeli") return null;
  if (detectForeignSource(p.input)) return null;
  return prepareFreeformHandoff(p.input);
}

/** A free-form foreign book the safe patterns did not read: hand it to the server parser instead of stopping here. */
function freeformModelDecision(p: LocalPlanInput): FreeformSearchRequest | null {
  if (p.manual || p.isPinpoint) return null;
  if (p.evidence.pasted.contract.route === "israeli") return null;
  if (detectForeignSource(p.input)) return null;
  if (eligibleBookCompletion(p.sourceType, p.input)) return null;
  return prepareFreeformModelHandoff(p.input, p.sourceType);
}

/** Source type for a free-form handoff, so the host can skip the classifier model. */
export function foreignFreeformSourceType(raw: string): SourceType | null {
  if (detectForeignSource(raw)) return null;
  return prepareFreeformHandoff(raw)?.sourceType ?? null;
}

/** Phase 2 — terminal local outcomes (render or preserve). Null → continue to typed planning. */
export function planLocalCitation(p: LocalPlanInput, caps: CitationHostCapabilities): { origin: LocalOrigin; resolution: CitationResolution } | { origin: null; statutePrep: StatutePreparation | null } {
  const { pasted } = p.evidence;
  const st = p.sourceType;
  // Bounded AU/CA completion: the typed request is the only next step.
  if (pasted.countryLookup) return { origin: null, statutePrep: null };
  if (pasted.country && pasted.local) return { origin: pasted.contract.route === "preserve" ? "preserve" : "deterministic", resolution: { ...pasted.local, status: "warning", pastedCitation: pasted.contract, sourceType: pasted.country.family === "case" ? "foreign_case_other" : "foreign" } };
  const gate = planCapabilityGate(p);
  if (gate) return gate;
  const handoff = freeformDecision(p);
  if (handoff?.mode === "local") return { origin: "preserve", resolution: { ...handoff.resolution, pastedCitation: pasted.contract } };
  if (handoff?.mode === "search") return { origin: null, statutePrep: null };
  if (pasted.local && !(caps.pastedLocalDefersOpinionFormat && OPINION(pasted.detection))) {
    const warnings = pasted.detection ? renderForeignDetection(pasted.detection)?.warnings ?? [] : [];
    return { origin: "pasted_local", resolution: { ...pasted.local, pastedCitation: pasted.contract,
      status: warnings.length ? "warning" : "valid", warningMsg: warnings[0] } };
  }
  const statutePrep = st && !p.isPinpoint ? prepareForeignStatute(st, p.input, { manual: p.manual }) : null;
  const bookCompletion = !p.isPinpoint ? eligibleBookCompletion(st, p.input) : null;
  const unreported = st && !p.isPinpoint ? (renderUsUnreportedLocal(st, p.input) ?? renderUnpublishedLocal(st, p.input) ??
    renderPeriodicalLocal(st, p.input) ?? (bookCompletion ? null : renderBookLocal(st, p.input, caps.bookDefersToDeterministic ? { deferToDeterministic: true } : undefined))) : null;
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
  if (freeformModelDecision(p)) return { origin: null, statutePrep };
  if ((st === "foreign_book" || st === "foreign_book_chapter") && !p.isPinpoint && !bookCompletion) {
    const citation = escapeCitationLiteral(p.evidence.pasted.contract.rawInput);
    const warningMsg = "לא סופקו עוגני מחבר וכותרת מובחנים ובטוחים להשלמת הספר או הפרק; הקלט נשמר ללא חיפוש.";
    return { origin: "preserve", resolution: { citation, reply: `${citation}\n⚠️ ${warningMsg}`, status: "warning", warningMsg, pastedCitation: p.evidence.pasted.contract } };
  }
  return { origin: null, statutePrep };
}

/**
 * Pure capability gate (no IO): the effective family/jurisdiction manifest
 * decision plus typed-completion eligibility. Hosts call it before any
 * verified-store cache/provider access; planLocalCitation reuses it.
 */
export function planCapabilityGate(p: LocalPlanInput): { origin: LocalOrigin; resolution: CitationResolution } | null {
  const { pasted } = p.evidence;
  if (pasted.countryLookup) return null;
  const question = countryFormQuestion(p);
  if (question) return question;
  if (pasted.country && pasted.local) return { origin: pasted.contract.route === "preserve" ? "preserve" : "deterministic", resolution: { ...pasted.local, status: "warning", pastedCitation: pasted.contract, sourceType: pasted.country.family === "case" ? "foreign_case_other" : "foreign" } };
  const disabled = (): { origin: LocalOrigin; resolution: CitationResolution } => {
    const citation = escapeCitationLiteral(pasted.contract.rawInput);
    return { origin: "preserve", resolution: { citation, reply: `${citation}\n⚠️ ${DISABLED_RULEPACK_WARNING}`, status: "warning", warningMsg: DISABLED_RULEPACK_WARNING, pastedCitation: pasted.contract } };
  };
  if (!rulepackAllowsLocal(p)) return disabled();
  const st = p.sourceType;
  if (!st || p.isPinpoint) return null;
  // Typed lookups are decided by the same manifest capability.
  const statutePrep = prepareForeignStatute(st, p.input, { manual: p.manual });
  if (statutePrep?.request && !rulepackLookupEligible("statute", statutePrep.request.jurisdiction)) return disabled();
  const bookCompletion = eligibleBookCompletion(st, p.input);
  if (bookCompletion && !rulepackLookupEligible(bookCompletion.kind, "OTHER")) return disabled();
  return null;
}

/** A manual country choice the user already made (never "UNKNOWN"). */
function chosenCountry(contract: PastedCitationContract): boolean {
  const j = contract.manualChoice?.jurisdiction;
  return !!j && j !== "UNKNOWN";
}

/**
 * A case whose citation form is used by more than one country (e.g. the Indian
 * "(2010) 5 SCC 1") is not searched anywhere: the user is asked for the country.
 */
function countryFormQuestion(p: LocalPlanInput): { origin: LocalOrigin; resolution: CitationResolution } | null {
  const { contract, country } = p.evidence.pasted;
  if (p.manual || country || chosenCountry(contract) || contract.route === "israeli") return null;
  if (!FOREIGN_CASE_SHAPE.test(contract.rawInput) || countryCues(contract.rawInput) !== "ambiguous") return null;
  const reply = countryQuestionReply(contract.rawInput, "ambiguous_form");
  return { origin: "preserve", resolution: {
    reply, citation: reply.split("\n")[0], status: "warning", warningMsg: reply.split("⚠️ ")[1], pastedCitation: contract,
    sourceType: "foreign_case_other", countryQuestion: buildCountryQuestion(contract.rawInput, "ambiguous_form"),
  } };
}

/** Shared manifest capability for the effective family/jurisdiction of a foreign input. */
function rulepackAllowsLocal(p: LocalPlanInput): boolean {
  const st = p.sourceType;
  if (st && !isForeignSourceType(st)) return true;
  const { contract, detection } = p.evidence.pasted;
  const identity = st ? toForeignIdentity(st) : null;
  const family = identity && identity.kind !== "other" ? identity.kind : detection?.kind;
  if (!family || family === "other") return true;
  const jurisdiction = contract.jurisdiction === "US" || contract.jurisdiction === "UK" ? contract.jurisdiction
    : identity && identity.kind === family ? identity.jurisdiction : detection?.jurisdiction ?? "UNKNOWN";
  const cap = rulepackCapability(family, jurisdiction);
  return cap.local && (family !== "case" || contract.route !== "foreign" || cap.lookup);
}

/** "X v. Y" shape (any common-law jurisdiction). */
const FOREIGN_CASE_SHAPE = /[A-Za-z][^\n]*?\s+v(?:s)?\.?\s+[A-Za-z]/;
export function extractForeignCaseName(raw: string): string | null {
  const m = raw.match(/^\s*(.+?\s+v(?:s)?\.?\s+.+?)(?:\s*[,(\[]\s*(?:\d|\[)|\s*\(|\s*\[|$)/);
  return m ? m[1].trim().replace(/[,\s]+$/, "") : null;
}
/** A case-shaped input without an explicit US/UK anchor goes out as UNKNOWN. */
export function planForeignLookup(sourceType: SourceType, raw: string, detection: ForeignDetection | null): { kind: ForeignSourceKind; jurisdiction: "US" | "UK" | "OTHER" | "UNKNOWN" } | null {
  const plan = planForeignLookupRoute(sourceType, raw, detection);
  // D1: typed lookup eligibility is expressed by the enabled rulepack manifest only.
  return plan && rulepackLookupEligible(plan.kind, plan.jurisdiction) ? plan : null;
}
function planForeignLookupRoute(sourceType: SourceType, raw: string, detection: ForeignDetection | null): { kind: ForeignSourceKind; jurisdiction: "US" | "UK" | "OTHER" | "UNKNOWN" } | null {
  if (preparePastedCitation(raw).country) return null;
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
  /** Existing article rawInput field from articleRequestFields. */
  extraBody: Record<string, unknown>;
  /** Complete local parsed fields (book/chapter) used for rendering; never sent on the wire. */
  localFields?: Record<string, string>;
  localSourceFields?: CompletionAcceptanceFields;
}
type CompletionAcceptanceFields = NonNullable<ReturnType<typeof acceptCitationCompletion>["suppliedFields"]>;

/** Phase 3 — the existing bound typed request, or an explicitly declared legacy handoff. */
export function planTypedRequest(p: LocalPlanInput & { statutePrep: StatutePreparation | null; canonicalRaw: string }, _caps: CitationHostCapabilities): TypedPlan {
  const { pasted } = p.evidence;
  const st = p.sourceType;
  if (pasted.countryLookup) {
    return { kind: "typed", evidence: p.evidence, sourceType: st, statutePrep: null, caseRequest: null, articleRequest: null,
      foreignLookup: { ...pasted.countryLookup, parsedFields: { ...pasted.countryLookup.parsedFields } }, extraBody: {} };
  }
  let foreignLookup: Record<string, unknown> | null = null;
  let articleRequest: TypedPlan["articleRequest"] = null;
  let extraBody: Record<string, unknown> = {};
  let localFields: Record<string, string> | undefined;
  let localSourceFields: CompletionAcceptanceFields | undefined;
  // Keep the existing Israeli article raw field; foreign articles share their DOI adapter.
  if (st === "article") extraBody = { ...articleRequestFields(st, p.input) };
  if (p.statutePrep?.request) {
    foreignLookup = { ...p.statutePrep.request };
  } else if (st && !p.isPinpoint && isForeignSourceType(st)) {
    const detection = detectForeignSource(p.input);
    const bookCompletion = eligibleBookCompletion(st, p.input);
    const plan = st === "foreign_book" || st === "foreign_book_chapter"
      ? bookCompletion ? { kind: bookCompletion.kind as ForeignSourceKind, jurisdiction: "OTHER" as const } : null
      : planForeignLookup(st, p.input, detection);
    if (plan && plan.kind !== "statute") {
      const parsedFields: Record<string, string> = plan.kind === "journal_article" ? parseForeignArticleInput(p.input) : {};
      if (bookCompletion) {
        Object.assign(parsedFields, bookCompletion.wire);
        localSourceFields = bookCompletion.suppliedFields;
        localFields = {};
        for (const [k, v] of Object.entries(bookCompletion.fields as Record<string, unknown>)) if (typeof v === "string" && v.trim()) localFields[k] = v.trim();
      } else if (detection) for (const [k, v] of Object.entries(detection.fields as Record<string, unknown>)) {
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
  if (caseRequest) articleRequest = null;
  const handoff = freeformDecision(p);
  if (handoff?.mode === "search" && (!foreignLookup || foreignLookup.kind === handoff.request.kind)) {
    foreignLookup = { ...(foreignLookup ?? {}), ...handoff.request, rawInput: p.input };
    if (handoff.request.kind === "journal_article") articleRequest = foreignLookup as { parsedFields: Record<string, string> };
  } else if (!handoff && !foreignLookup) {
    const model = freeformModelDecision(p);
    if (model) foreignLookup = { ...model };
  }
  const typed = !!(foreignLookup || p.statutePrep?.request);
  return { kind: typed ? "typed" : "legacy", evidence: p.evidence, sourceType: st, statutePrep: p.statutePrep, caseRequest, articleRequest, foreignLookup, extraBody,
    ...(localFields && !caseRequest ? { localFields, localSourceFields } : {}) };
}

export type ResponseResolution =
  | { kind: "terminal"; origin: "safety" | "case" | "statute" | "disambiguation" | "article" | "merge"; resolution: CitationResolution }
  | { kind: "reject"; code: "EMPTY_RESPONSE" }
  | { kind: "legacy" };

/** One terminal acceptance path for every existing typed request; legacy requests alone hand off. */
export function resolveCitationResponse(plan: TypedPlan, data: Record<string, unknown> | null, caps: CitationHostCapabilities): ResponseResolution {
  const contract = plan.evidence.pasted.contract;
  const safety = readPastedCitationSafety(contract, data);
  if (safety) return { kind: "terminal", origin: "safety", resolution: { ...safety, status: "warning", pastedCitation: contract } };
  if (plan.kind === "legacy" || !plan.foreignLookup) return { kind: "legacy" };
  const response = data?.foreignLookup;
  if (plan.evidence.pasted.countryLookup && (plan.foreignLookup.jurisdiction === "AU" || plan.foreignLookup.jurisdiction === "CA")) {
    return resolveCountryResponse(plan, plan.foreignLookup as unknown as CountryLookupRequest, response, data?.pastedCitation, caps);
  }
  const req = bindFreeformResponseFields(plan.foreignLookup, typeof plan.foreignLookup.rawInput === "string" ? plan.foreignLookup.rawInput : contract.rawInput, response);
  if (req.kind === "book" || req.kind === "book_chapter") {
    const resolution = resolveBookCompletion(req, contract.rawInput, response, plan.localFields ?? {}, plan.localSourceFields, contract.missing);
    // Adopt server final content only after the same full-evidence resolver
    // proves exact parity. Arbitrary client text cannot override a conflict.
    if (typeof data?.content === "string" && data.content === resolution.reply) resolution.reply = data.content;
    return { kind: "terminal", origin: "merge", resolution: { ...resolution, sourceLabel: SOURCE_TYPE_LABELS[resolution.sourceType], pastedCitation: contract } };
  }
  const boundSupplied = req.parsedFields && typeof req.parsedFields === "object" ? req.parsedFields as Record<string, string> : {};
  const accepted = acceptCitationCompletion({ ...req, parsedFields: { ...boundSupplied, ...(plan.localFields ?? {}) } }, contract.rawInput, response);
  if (plan.localSourceFields) accepted.suppliedFields = plan.localSourceFields;
  const st = plan.sourceType;
  const warnings: string[] = [];
  const messages = {
    binding: "תשובת החיפוש סותרת את הקלט, סוג המקור או השיפוט; הקלט נשמר ללא השלמה.",
    jurisdiction: "פרטי השיפוט שהוחזרו סותרים את ראיות הערכאה או מקור הפרסום שסופקו או עוגנו; הקלט נשמר ללא השלמה.",
    malformed: "תשובת החיפוש אינה בפורמט נתמך; נשמרו רק הפרטים שסופקו.",
    unavailable: "חיפוש פרטי המקור לא היה זמין; נשמרו רק הפרטים שסופקו.",
    identity: "לא אומתה התאמת המקור לפרטים שסופקו או נמצאו פרטים סותרים; נשמרו רק הפרטים שסופקו.",
    chapter_identity: "לא אומתה זהות הפרק המבוקש בנפרד מזהות הספר או האסופה; נשמרו רק הפרטים שסופקו ללא השלמה.",
    ambiguous: "נדרשת בחירה בין כמה פסקי דין",
  };
  if (accepted.reason) warnings.push(messages[accepted.reason]);
  if (accepted.quarantined.length) warnings.push("פרטים סותרים או ללא ראיות מספקות לא שולבו: " + accepted.quarantined.join(", ") + ".");
  const fl = response && typeof response === "object" ? response as Record<string, unknown> : {};
  // A caption the US/UK search could not ground is not answered with an unrelated
  // record: the chat asks for the country instead (no further search until chosen).
  if (caps.host === "chat" && req.kind === "case" && req.jurisdiction === "UNKNOWN" && accepted.reason === "identity" &&
      (fl.identity as { matched?: unknown } | undefined)?.matched !== true && !chosenCountry(contract) &&
      typeof (req.parsedFields as Record<string, unknown> | undefined)?.caseName === "string") {
    const reply = countryQuestionReply(contract.rawInput, "not_found");
    return { kind: "terminal", origin: "case", resolution: {
      reply, citation: reply.split("\n")[0], status: "warning", warningMsg: reply.split("⚠️ ")[1], pastedCitation: contract,
      sourceType: "foreign_case_other", sourceLabel: SOURCE_TYPE_LABELS.foreign_case_other, completion: accepted,
      countryQuestion: buildCountryQuestion(contract.rawInput, "not_found"),
    } };
  }
  if (accepted.reason === "ambiguous" && req.kind === "case" && Array.isArray(fl.disambiguation)) {
    const choices = fl.disambiguation.filter((v): v is { jurisdiction: "US" | "UK"; label: string; url: string } => {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;
      if (!["US", "UK"].includes(String(o.jurisdiction)) || typeof o.label !== "string" || !o.label.trim() || typeof o.url !== "string") return false;
      try { return ["https:", "http:"].includes(new URL(o.url).protocol); } catch { return false; }
    });
    if (choices.length > 1) {
      const foreignChoice = offersRecordChoice(caps) ? buildForeignCaseChoice(plan, response, data?.pastedCitation, "decision") : null;
      return { kind: "terminal", origin: "disambiguation", resolution: {
        citation: "", reply: `נמצאו כמה פסקי דין אפשריים בשם זה. כדי לא לנחש, בחרו את הנכון והוסיפו את הערכאה או השנה:\n${choices.slice(0, 5).map((o, i) => escapeCitationLiteral(`${i + 1}. ${o.label} (${o.jurisdiction}) — ${o.url}`)).join("\n")}`,
        status: "warning", warningMsg: messages.ambiguous, pastedCitation: contract,
        completion: accepted, ...(foreignChoice ? { foreignChoice } : {}),
      } };
    }
  }
  // One decision reported in several parallel reports: the priority rule is not
  // verified, so the user chooses instead of the system picking one.
  const locationChoices = req.kind === "case" && accepted.identityConfirmed ? readLocationChoice(fl, accepted.jurisdiction) : null;
  const locationChoice = locationChoices && offersRecordChoice(caps) ? buildForeignCaseChoice(plan, response, data?.pastedCitation, "location") : null;
  if (locationChoices) return { kind: "terminal", origin: "disambiguation", resolution: {
    ...(locationChoice ? { foreignChoice: locationChoice } : {}),
    citation: "", reply: `נמצאו כמה מראי מקום מקבילים לאותו פסק דין. כלל הקדימות ביניהם טרם אומת, ולכן לא נבחר אחד מהם אוטומטית. בחרו את מראה המקום הרצוי:\n${locationChoices.slice(0, 5).map((o, i) => escapeCitationLiteral(`${i + 1}. ${o.label} — ${o.url}`)).join("\n")}`,
    status: "warning", warningMsg: "נדרשת בחירה בין מראי מקום מקבילים", pastedCitation: contract,
    completion: accepted,
  } };
  const wireSupplied = req.parsedFields && typeof req.parsedFields === "object" ? req.parsedFields as Record<string, string> : {};
  const supplied = { ...wireSupplied, ...(plan.localFields ?? {}) };
  let rendered: { citation: string; reply?: string; missing?: string[]; warnings?: string[] } | null = null;
  const kind = req.kind as ForeignSourceKind;
  // AU/CA never reach this US/UK/OTHER renderer (they resolve in resolveCountryResponse).
  const acceptedJur = accepted.jurisdiction === "AU" || accepted.jurisdiction === "CA" ? null : accepted.jurisdiction;
  const jur = acceptedJur ?? (req.jurisdiction === "US" || req.jurisdiction === "UK" ? req.jurisdiction : "OTHER");
  const effectiveType = kind === "case" ? toSourceType(kind, jur) : st ?? toSourceType(kind, jur);
  if (kind === "statute" && plan.statutePrep) {
    rendered = renderForeignStatuteLookup(plan.statutePrep, { ...fl, fields: accepted.fields,
      identity: { matched: accepted.identityConfirmed, jurisdiction: jur, conflicts: [] } });
  } else if (kind === "journal_article" && plan.articleRequest) {
    // A sanitized response never replaces supplied authors (including abbreviations).
    rendered = renderForeignArticleLookup(plan.articleRequest, { fields: accepted.fields, identity: { matched: accepted.identityConfirmed, conflicts: [] }, articleResolution: "incomplete" });
  } else if (accepted.identityConfirmed) {
    const fields: Record<string, unknown> = { ...accepted.fields, ...supplied };
    // The typed party names keep their words; only their letter case follows a
    // verified title of the accepted record (presentation, never identity).
    if (kind === "case" && typeof supplied.caseName === "string") {
      const titles = Object.values(accepted.provenance).map((p) => (p as { sourceTitle?: unknown } | null)?.sourceTitle).filter((t): t is string => typeof t === "string");
      const cased = adoptVerifiedCasing(supplied.caseName, titles);
      if (cased) fields.caseName = cased;
    }
    rendered = renderForeignDetection({ kind, jurisdiction: jur, sourceType: effectiveType,
      confidence: "deterministic", fields: fields as ForeignFields });
  }
  if (accepted.identityConfirmed && Array.isArray((fl.identity as { conflicts?: unknown } | undefined)?.conflicts) && ((fl.identity as { conflicts: unknown[] }).conflicts.length)) warnings.push("נמצאו פרטי פרסום סותרים; נשמרו רק השלמות תואמות.");
  if (rendered?.warnings) warnings.push(...rendered.warnings);
  if (rendered?.missing?.length) warnings.push(`חסרים פרטים: ${getMissingFieldsSummary(effectiveType, rendered.missing)}`);
  if (rendered?.reply?.includes("⚠️")) warnings.push(rendered.reply.split("⚠️").slice(1).join(" ").trim());
  // Unknown spans remain in the evidence contract and are never lost through partial rendering.
  const citation = rendered?.citation.trim() || escapeCitationLiteral(contract.rawInput);
  accepted.missing = rendered?.missing ?? contract.missing;
  accepted.completeness = !accepted.identityConfirmed ? "unconfirmed" : accepted.missing.length ? "partial" : "complete";
  const bits = [...new Set(warnings.filter(Boolean))];
  return { kind: "terminal", origin: kind === "case" ? "case" : kind === "statute" ? "statute" : kind === "journal_article" ? "article" : "merge", resolution: {
    citation, reply: citation + (bits.length ? `\n⚠️ ${bits.join(" ")}` : ""),
    status: bits.length ? "warning" : "valid", warningMsg: bits[0],
    sourceType: effectiveType, sourceLabel: SOURCE_TYPE_LABELS[effectiveType], pastedCitation: contract,
    completion: accepted,
  } };
}

const COUNTRY_FAIL_MESSAGES: Record<string, string> = {
  unavailable: "חיפוש פרטי המקור לא היה זמין; הקלט נשמר ללא השלמה.",
  not_found: "לא נמצאה במקורות הרשמיים או במאגרים המוכרים רשומה שתואמת לקלט ולשמות שסופקו; הקלט נשמר ללא השלמה.",
  ambiguous: "נמצאו כמה רשומות אפשריות; כדי לא לנחש, הקלט נשמר ללא השלמה. הוסיפו שנה, ערכאה או מספר.",
  conflict: "הפרטים שנמצאו סותרים את הפרטים שסופקו; הקלט נשמר ללא השלמה.",
  binding: "תשובת החיפוש אינה תואמת לקלט או לתבנית הנתמכת; הקלט נשמר ללא השלמה.",
  incomplete: "הפרטים שנמצאו אינם משלימים אזכור מלא בתבנית הנתמכת; הקלט נשמר ללא השלמה.",
};

/** Bounded AU/CA completion: the shared acceptance decides; the local template renders. */
function resolveCountryResponse(plan: TypedPlan, request: CountryLookupRequest, response: unknown, pastedCitation: unknown, caps: CitationHostCapabilities): ResponseResolution {
  const contract = plan.evidence.pasted.contract;
  const sourceType: SourceType = request.kind === "case" ? "foreign_case_other" : "foreign";
  const base = { pastedCitation: contract, sourceType, sourceLabel: SOURCE_TYPE_LABELS[sourceType] };
  const a = acceptCountryResponse(request, contract.rawInput, response);
  if (a.kind === "choice") {
    const choice = offersRecordChoice(caps) ? buildCountryCaseChoice(plan, request, response, pastedCitation, a.stage, a.decisions) : null;
    const options = choice?.options ?? (a.stage === "decision"
      ? a.decisions.map((d) => ({ id: d.id, label: d.label, url: Object.values(d.options[0].sources)[0].url }))
      : a.decisions[0].options.map((o) => ({ id: o.id, label: o.label, url: Object.values(o.sources)[0].url })));
    const reply = a.stage === "decision" ? decisionChoiceReply(options) : locationChoiceReply(options);
    return { kind: "terminal", origin: "disambiguation", resolution: { ...base, citation: "", reply, status: "warning",
      warningMsg: a.stage === "decision" ? "נדרשת בחירה בין כמה פסקי דין" : "נדרשת בחירה בין מראי מקום מקבילים", ...(choice ? { foreignChoice: choice } : {}) } };
  }
  if (a.kind === "fail") {
    const citation = escapeCitationLiteral(contract.rawInput);
    const warningMsg = COUNTRY_FAIL_MESSAGES[a.reason];
    return { kind: "terminal", origin: request.kind === "case" ? "case" : "statute", resolution: { ...base, citation, reply: `${citation}\n⚠️ ${warningMsg}`, status: "warning", warningMsg } };
  }
  const warningMsg = `הפרטים החסרים הושלמו מתוך: ${a.sourceUrls.join(", ")}. מומלץ לבדוק מול המקור.`;
  const completion: ReturnType<typeof acceptCitationCompletion> = {
    fields: a.fields, provenance: a.provenance, quarantined: [], identityConfirmed: true, jurisdiction: request.jurisdiction,
    missing: [], conflicts: [], completeness: "complete",
  };
  return { kind: "terminal", origin: request.kind === "case" ? "case" : "statute", resolution: { ...base, citation: a.citation,
    reply: `${a.citation}\n⚠️ ${escapeCitationLiteral(warningMsg)}`, status: "warning", warningMsg, completion } };
}

export type ForeignChoiceOutcome =
  | { kind: "stale" }
  | { kind: "invalid" }
  | { kind: "resolved"; resolution: CitationResolution };

/**
 * Apply a user's choice between foreign case records. No IO: the chosen record
 * goes through the same acceptance and rendering as a lookup response.
 */
export function selectForeignCaseChoice(choice: ForeignCaseChoice, optionId: string, currentInputs: string[], caps: CitationHostCapabilities): ForeignChoiceOutcome {
  const prepared = prepareChoiceSelection(choice, optionId, currentInputs);
  const contract = choice.plan.evidence.pasted.contract;
  if (prepared.kind === "stale" || prepared.kind === "invalid") return prepared;
  if (prepared.kind === "choice") return { kind: "resolved", resolution: {
    citation: "", reply: prepared.reply, status: "warning", warningMsg: "נדרשת בחירה בין מראי מקום מקבילים",
    pastedCitation: contract, foreignChoice: prepared.choice,
  } };
  const resolved = resolveCitationResponse(choice.plan, prepared.data, caps);
  if (resolved.kind !== "terminal" || resolved.origin === "disambiguation") return { kind: "invalid" };
  const { foreignChoice: _ignored, ...resolution } = resolved.resolution;
  return { kind: "resolved", resolution };
}
