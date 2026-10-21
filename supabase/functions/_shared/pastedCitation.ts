/** Batch A: pure supplied-text evidence, shared by browser and server. No I/O or identity claims. */
import { CASE_DOCKET_RE, findBareDocket } from "./caseTypePrefixes.ts";
import { LOOKUP_JURISDICTIONS, PLANNED_RULEPACK_WARNING, isGeneralFamily, isManualChoiceJurisdiction, isPlannedJurisdiction, readRulepackVersion, rulepackCapability, rulepackJurisdictionFromId } from "./citationPure/rulepack.ts";
import { parseCountryLocal } from "./citationPure/countryLocal.ts";
export const PASTED_CITATION_VERSION = 1 as const;
/** D1: AU/CA/FR are recorded (never cast to US/IL/UNKNOWN); their rulepacks are planned/disabled. */
export type CitationJurisdiction = "IL" | "US" | "UK" | "DE" | "AU" | "CA" | "FR" | "UNKNOWN";
export interface InputSpan { start: number; end: number }
export interface SuppliedField {
  value: string | null;
  state: "supplied" | "unknown";
  provenance: "supplied_text" | "existing_parser" | "none";
  spans: InputSpan[];
}
export interface CitationManualChoice { jurisdiction?: CitationJurisdiction; jurisdictionId?: string; subjurisdiction?: string; sourceType?: string; foreign?: boolean }
export interface PastedCitationContract {
  version: typeof PASTED_CITATION_VERSION;
  rawInput: string;
  fingerprint: string;
  sourceKind: string | null;
  jurisdiction: CitationJurisdiction;
  subjurisdiction: string | null;
  subjurisdictionEvidence: Array<{ value: string; provenance: "supplied_text" | "manual_choice"; spans: InputSpan[] }>;
  evidence: Array<{ jurisdiction: CitationJurisdiction; signal: "court" | "reporter" | "prefix" | "parties" | "code"; span: InputSpan }>;
  candidates: { court: SuppliedField[]; reporter: SuppliedField[]; docket: SuppliedField[] };
  manualChoice: CitationManualChoice | null;
  fields: Record<string, SuppliedField>;
  unknownSpans: InputSpan[];
  classification: "identified_foreign" | "identified_israeli" | "ambiguous" | "conflicting";
  formatter: "existing_route" | "unsupported" | "unknown";
  missing: string[];
  conflicts: string[];
  unsupported: string[];
  identityVerified: false;
  route: "israeli" | "foreign" | "existing" | "preserve";
}
export function rawCitationFingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { hash ^= raw.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `pc1:${raw.length}:${hash.toString(16)}`;
}
/** Existing compatibility choices constrain a family; they never supply identity. */
export function citationSourceKind(sourceType?: string): string | null {
  if (!sourceType || ["foreign", "unknown", "other"].includes(sourceType)) return null;
  if (sourceType.startsWith("case_law_") || sourceType.startsWith("foreign_case_")) return "case";
  const kinds: Record<string, string> = {
    foreign_book: "book", book: "book", foreign_book_chapter: "book_chapter", article_in_book: "book_chapter",
    foreign_journal_article: "journal_article", article: "journal_article", foreign_newspaper: "newspaper",
    foreign_statute_us: "statute", foreign_statute_uk: "statute", primary_legislation: "statute", secondary_legislation: "statute", basic_law: "statute",
    foreign_constitution: "constitution", foreign_internet: "internet", internet: "internet",
    foreign_unpublished_manuscript: "unpublished_manuscript", foreign_thesis: "thesis",
  };
  return kinds[sourceType] ?? sourceType;
}
/** Only the existing presentation wrappers are removable, not arbitrary bracketed source text. */
export function citationUserText(text: string): string {
  return text
    .replace(/(?:^|\n)══ (?:מנוע(?: אזכור)?|מקור מאומת)[^\n]* ══\n[\s\S]*?\n═{3,}(?=\n|$)/g, "\n")
    .replace(/^(?:\[(?:סיווג שיפוט ידני|סיווג אוטומטי|תיקון סיווג|כלל רלוונטי):[^\n]*\]|\[בחירת תוצאה\])\s*/gm, "")
    .trim();
}
/** Presentation-only quote/whitespace normalization; no words or source tokens can be replaced. */
export function citationBindingText(text: string): string {
  return text.replace(/״/g, '"').replace(/׳/g, "'").replace(/\s+/g, " ").trim();
}
const lookupFieldKinds: Record<string, readonly string[]> = {
  case: ["caseName", "volume", "reporter", "firstPage", "pinpoint", "paragraph", "court", "year", "docket", "databaseIdentifier", "starPinpoint", "decisionDate", "reporterVolume", "neutral", "ukVolume", "ukSeries", "parallel", "unparsedRemainder"],
  statute: ["statuteName", "titleNumber", "code", "section", "subsection", "chapter", "year", "regnalYear", "monarch", "unparsedRemainder"],
  journal_article: ["authors", "author", "articleTitle", "journal", "volume", "firstPage", "pinpoint", "year", "doi", "sourceUrl", "unparsedRemainder"],
  book: ["authors", "author", "bookTitle", "title", "edition", "editors", "translators", "volume", "pinpoint", "year", "unparsedRemainder"],
  book_chapter: ["authors", "author", "chapterTitle", "bookTitle", "edition", "editors", "translators", "volume", "firstPage", "pinpoint", "year", "unparsedRemainder"],
};
export function suppliedLookupFieldsMatch(raw: string, kind: string, fields: unknown): boolean {
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || !lookupFieldKinds[kind]) return false;
  const normalized = citationBindingText(raw);
  return Object.entries(fields).every(([key, value]) => lookupFieldKinds[kind].includes(key) && typeof value === "string" &&
    (!value || normalized.includes(citationBindingText(value))));
}
function field(raw: string, value: string, provenance: SuppliedField["provenance"]): SuppliedField {
  const start = raw.indexOf(value);
  // Normalized parser output is not falsely represented as a supplied span.
  return start < 0 ? { value: null, state: "unknown", provenance: "none", spans: [] }
    : { value, state: "supplied", provenance, spans: [{ start, end: start + value.length }] };
}
const unknown = (): SuppliedField => ({ value: null, state: "unknown", provenance: "none", spans: [] });
export function buildPastedCitation(raw: string, manual: CitationManualChoice | null = null,
  parser?: { kind: string; fields: Record<string, unknown> }): PastedCitationContract {
  const evidence: PastedCitationContract["evidence"] = [];
  const candidates: PastedCitationContract["candidates"] = { court: [], reporter: [], docket: [] };
  const fields: Record<string, SuppliedField> = Object.fromEntries(
    ["caseName", "court", "reporter", "docket", "year", "decisionDate", "volume", "firstPage"].map(k => [k, unknown()]));
  const add = (re: RegExp, jurisdiction: CitationJurisdiction, signal: PastedCitationContract["evidence"][number]["signal"]) => {
    let count = 0;
    for (const m of raw.matchAll(new RegExp(re.source, "g"))) {
      if (count++ >= 16) break; // Per-signal cap cannot hide another jurisdiction; raw text remains intact.
      const span = { start: m.index, end: m.index + m[0].length };
      evidence.push({ jurisdiction, signal, span });
      if (signal === "court" || signal === "reporter") candidates[signal].push(field(raw, m[0], "supplied_text"));
    }
  };
  // Bounded explicit signals, not a country dictionary or language detector.
  add(/\bBVerfG\b|\bBvR\b/, "DE", "court");
  add(/\bBVerfGE\b/, "DE", "reporter");
  add(/\bBGH\b/, "DE", "court");
  add(/\bBGH(?:Z|St)\b/, "DE", "reporter");
  add(/\bU\.\s?S\.(?!\s?C\.)|\bF\.\s?(?:2d|3d|4th|Supp\.)/, "US", "reporter");
  add(/\b(?:D\. Mass\.|S\.D\.N\.Y\.|\d+(?:st|nd|rd|th|d) Cir\.)/, "US", "court");
  add(/\bU\.\s?S\.\s?C\.|\bU\.\s?S\.\s?CONST\./, "US", "code");
  add(/\b(?:UKSC|UKHL|UKPC|EWCA|EWHC)\b/, "UK", "court");
  add(/\b(?:WLR|All ER)\b/, "UK", "reporter");
  add(/\b(?:CLR|FCR)\b/, "AU", "reporter");
  add(/\b(?:HCA|FCA|FCAFC)\b/, "AU", "court");
  add(/\bCth\b|\(Austl\.\)/, "AU", "code");
  add(/\bSCC\b|\bCanLII\b|\bQuicklaw\b/, "CA", "court");
  add(/\bSCR\b|S\.C\.R\./, "CA", "reporter");
  add(/(?<![A-Za-z.])R\.?S\.?C\.?\b|(?<![A-Za-z.])S\.C\.|\(Can\.\)/, "CA", "code");
  const country = parseCountryLocal(raw, manual);
  const prefixed = raw.match(CASE_DOCKET_RE);
  if (prefixed) {
    const start = prefixed.index ?? 0;
    evidence.push({ jurisdiction: "IL", signal: "prefix", span: { start, end: start + prefixed[1].length } });
    fields.docket = field(raw, prefixed[2], "supplied_text");
  }
  const parties = /[א-ת][א-ת\s"״׳'.-]*\s+(?:נ['׳״]?|נגד)\s+[א-ת][א-ת\s"״׳'.-]*/.exec(raw);
  if (parties) evidence.push({ jurisdiction: "IL", signal: "parties", span: { start: parties.index, end: parties.index + parties[0].length } });
  const bare = findBareDocket(raw);
  if (bare && fields.docket.state === "unknown") fields.docket = field(raw, bare.docket, "supplied_text");
  if (fields.docket.state === "supplied") candidates.docket.push(fields.docket);
  if (parser) for (const [key, value] of Object.entries(parser.fields)) {
    if (typeof value === "string" && value) fields[key] = field(raw, value, "existing_parser");
    else if (Array.isArray(value) && value.every(v => typeof v === "string")) {
      const parts = value.map(v => field(raw, v, "existing_parser"));
      fields[key] = { value: parts.every(p => p.value !== null) ? value.join(", ") : null,
        state: parts.every(p => p.value !== null) ? "supplied" : "unknown", provenance: "existing_parser", spans: parts.flatMap(p => p.spans) };
    }
  }
  const jurisdictions = [...new Set(evidence.map(e => e.jurisdiction))];
  const detected = jurisdictions.length === 1 ? jurisdictions[0] : "UNKNOWN";
  const conflicts: string[] = jurisdictions.length > 1 ? ["conflicting_text_jurisdictions"] : [];
  if (manual?.jurisdiction && manual.jurisdiction !== "UNKNOWN" && detected !== "UNKNOWN" && manual.jurisdiction !== detected)
    conflicts.push("manual_jurisdiction_conflict");
  if (manual?.foreign && detected === "IL") conflicts.push("manual_foreign_israeli_conflict");
  // A manual choice is recorded, not evidence authorizing Israeli docket lookup.
  const jurisdiction = detected !== "UNKNOWN" ? detected : manual?.jurisdiction ?? "UNKNOWN";
  const foreignShape = /[A-Za-z][^\n]*?\s+v(?:s)?\.?\s+[A-Za-z]/.test(raw);
  const caseInput = !!prefixed || !!bare || foreignShape || evidence.some(e => e.signal === "court" || e.signal === "reporter");
  // Existing parsed literature can contain numbers/case titles without becoming a decision.
  const sourceKind = country?.family ?? parser?.kind ?? (caseInput ? "case" : evidence.some(e => e.signal === "code") ? "statute" : null);
  const manualKind = citationSourceKind(manual?.sourceType);
  // This foundation gates decision-vs-other-family crossings only. Existing
  // literature/statute helpers retain their more precise subtype ambiguity gates.
  if (manualKind && sourceKind && manualKind !== sourceKind && (manualKind === "case" || sourceKind === "case")) conflicts.push("manual_source_kind_conflict");
  const unsupported = jurisdiction === "DE" ? ["formatter_DE_not_supported"] :
    // Disabled country packs block country-scoped families only; enabled general literature keeps its template.
    isPlannedJurisdiction(jurisdiction) && !(isGeneralFamily(manualKind ?? sourceKind) && sourceKind !== "case") ? [`rulepack_planned_disabled:${jurisdiction}`] :
    manual?.jurisdiction === "UNKNOWN" && (manual.jurisdictionId || manual.subjurisdiction) && caseInput ? ["jurisdiction_formatter_unknown"] : [];
  const route = conflicts.length || unsupported.length || (!!bare && detected === "UNKNOWN" && !foreignShape)
    ? "preserve" : detected === "IL" ? "israeli" : detected !== "UNKNOWN" || foreignShape || manual?.foreign ? "foreign" : "existing";
  if (country) {
    for (const [key, f] of Object.entries(country.fields)) fields[key] = { value: f.value, state: "supplied", provenance: "supplied_text", spans: f.spans };
    if (country.conflicts.length) { conflicts.push(...country.conflicts); }
  }
  const missing = caseInput ? ["caseName", "year", "reporter"].filter(k => fields[k]?.state !== "supplied") : [];
  if (caseInput && detected === "UNKNOWN") missing.push("jurisdiction_evidence");
  const covered = [...evidence.map(e => e.span), ...Object.entries(fields).filter(([k]) => k !== "unparsedRemainder").flatMap(([,f]) => f.spans)].sort((a,b) => a.start-b.start);
  const unknownSpans: InputSpan[] = [];
  let cursor = 0;
  for (const s of covered) { if (s.start > cursor) unknownSpans.push({ start: cursor, end: s.start }); cursor = Math.max(cursor, s.end); }
  if (cursor < raw.length) unknownSpans.push({ start: cursor, end: raw.length });
  const subSignal = evidence.find(e => e.jurisdiction === "UK" && /^(EWCA|EWHC)$/.test(raw.slice(e.span.start,e.span.end)));
  const subjurisdiction = manual?.subjurisdiction ?? (subSignal ? "t2:united-kingdom/england-and-wales" : null);
  const subjurisdictionEvidence: PastedCitationContract["subjurisdictionEvidence"] = [
    ...(subSignal ? [{ value: "t2:united-kingdom/england-and-wales", provenance: "supplied_text" as const, spans: [subSignal.span] }] : []),
    ...(manual?.subjurisdiction ? [{ value: manual.subjurisdiction, provenance: "manual_choice" as const, spans: [] }] : []),
  ];
  return { version: PASTED_CITATION_VERSION, rawInput: raw, fingerprint: rawCitationFingerprint(raw),
    sourceKind, jurisdiction, subjurisdiction, subjurisdictionEvidence,
    evidence, candidates, manualChoice: manual, fields, unknownSpans,
    classification: conflicts.length ? "conflicting" : detected === "IL" ? "identified_israeli" : detected !== "UNKNOWN" ? "identified_foreign" : "ambiguous",
    formatter: unsupported.length ? "unsupported" : jurisdiction === "UNKNOWN" ? "unknown" : "existing_route",
    missing: country?.missing ?? missing, conflicts, unsupported, identityVerified: false, route: country && !country.complete ? "preserve" : route };
}
export function pastedCitationWarning(c: PastedCitationContract): string {
  return c.conflicts.length === 0 && c.unsupported.some(u => u.startsWith("rulepack_planned_disabled:")) ? PLANNED_RULEPACK_WARNING
    : c.conflicts.includes("manual_source_kind_conflict") ? "סוג המקור שנבחר ופרטי המקור שסופקו סותרים זה את זה; הקלט נשמר ללא השלמה."
    : c.conflicts.length ? "הסיווג שנבחר או פרטי השיפוט סותרים את הקלט; נשמר המקור שסופק ללא השלמה."
    : c.unsupported.length ? "עיצוב האזכור בתחום השיפוט שזוהה אינו נתמך; הקלט נשמר, וזהות המקור לא אומתה."
    : "חסרה ראיה לתחום השיפוט או לפרטי המקור; הקלט נשמר ללא אימות. יש לציין ערכאה או תחום שיפוט.";
}
/** Derive from supplied messages as well as rawInput: client declarations never override text evidence. */
export function guardPastedCitationRequest(body: { messages: Array<{ role: string; content: string }>; rawInput?: unknown; foreignLookup?: unknown; pastedCitation?: unknown }) {
  const last = [...body.messages].reverse().find(m => m.role === "user")?.content ?? "";
  const manualLine = last.match(/\[סיווג שיפוט ידני: (\{[^\n]*\})\]/)?.[1];
  const stripped = citationUserText(last);
  // Preserve the exact original only after proving presentation-equivalent binding.
  const raw = typeof body.rawInput === "string" && citationBindingText(body.rawInput) === citationBindingText(stripped) ? body.rawInput : stripped;
  const wire = body.pastedCitation as Partial<PastedCitationContract> | undefined;
  let retainedChoice: CitationManualChoice | null = null;
  if (manualLine) { try { retainedChoice = JSON.parse(manualLine); } catch { /* malformed choice is not evidence */ } }
  const choice = wire?.version === 1 ? wire.manualChoice : retainedChoice;
  // The jurisdiction id resolves through the shared runtime mapping; a supplied code must agree with it.
  const objectChoice = choice && typeof choice === "object" && !Array.isArray(choice) ? choice : null;
  const idJurisdiction = typeof objectChoice?.jurisdictionId === "string" && objectChoice.jurisdictionId.length <= 200
    ? rulepackJurisdictionFromId(objectChoice.jurisdictionId) : null;
  const codeMalformed = objectChoice?.jurisdiction !== undefined && !isManualChoiceJurisdiction(objectChoice.jurisdiction);
  const codeMismatch = !!idJurisdiction && isManualChoiceJurisdiction(objectChoice?.jurisdiction) && objectChoice!.jurisdiction !== idJurisdiction;
  const manualJurisdiction = idJurisdiction ?? (isManualChoiceJurisdiction(objectChoice?.jurisdiction) ? objectChoice!.jurisdiction : undefined);
  const manual = objectChoice ? {
    ...(manualJurisdiction ? { jurisdiction: manualJurisdiction } : {}),
    ...(typeof choice.subjurisdiction === "string" && choice.subjurisdiction.length <= 200 ? { subjurisdiction: choice.subjurisdiction } : {}),
    ...(typeof choice.jurisdictionId === "string" && choice.jurisdictionId.length <= 200 ? { jurisdictionId: choice.jurisdictionId } : {}),
    ...(typeof choice.sourceType === "string" && choice.sourceType.length <= 200 ? { sourceType: choice.sourceType } : {}),
    ...(typeof choice.foreign === "boolean" ? { foreign: choice.foreign } : {}),
  } : null;
  const c = buildPastedCitation(raw, manual);
  if (codeMalformed) { c.route = "preserve"; c.conflicts.push("manual_jurisdiction_malformed"); }
  if (codeMismatch) { c.route = "preserve"; c.conflicts.push("manual_jurisdiction_id_mismatch"); }
  if (body.rawInput != null && (typeof body.rawInput !== "string" || citationBindingText(body.rawInput) !== citationBindingText(raw))) {
    c.route = "preserve"; c.conflicts.push("request_text_conflict");
  }
  if (choice && (typeof choice.subjurisdiction === "string" && choice.subjurisdiction.length > 200 || typeof choice.sourceType === "string" && choice.sourceType.length > 200)) {
    c.route = "preserve"; c.conflicts.push("manual_metadata_unsupported");
  }
  const messageEvidence = buildPastedCitation(stripped);
  if (messageEvidence.route === "preserve" || (messageEvidence.classification === "identified_foreign" && c.classification === "identified_israeli")) {
    c.route = "preserve"; c.conflicts.push("request_text_conflict");
  }
  if (wire && (wire.version !== 1 || typeof wire.rawInput !== "string" || wire.fingerprint !== rawCitationFingerprint(wire.rawInput) || citationBindingText(wire.rawInput) !== citationBindingText(raw))) {
    c.route = "preserve"; c.conflicts.push("contract_input_mismatch");
  }
  const lookup = body.foreignLookup as { rawInput?: unknown; kind?: unknown; jurisdiction?: unknown; parsedFields?: unknown; enabled?: unknown } | null;
  if (lookup && (typeof lookup !== "object" || Array.isArray(lookup) || lookup.enabled !== true || typeof lookup.rawInput !== "string" ||
    citationBindingText(lookup.rawInput) !== citationBindingText(raw) || typeof lookup.kind !== "string" || !lookupFieldKinds[lookup.kind] ||
    (c.sourceKind && lookup.kind !== c.sourceKind) || (citationSourceKind(manual?.sourceType) && lookup.kind !== citationSourceKind(manual?.sourceType)) ||
    !suppliedLookupFieldsMatch(raw, String(lookup.kind), lookup.parsedFields ?? {}))) {
    c.route = "preserve"; c.conflicts.push("lookup_source_binding_conflict");
  }
  if (lookup && typeof lookup === "object" && !Array.isArray(lookup)) {
    if (c.jurisdiction === "AU" || c.jurisdiction === "CA") { c.route = "preserve"; c.conflicts.push("rulepack_lookup_disabled"); }
    // Same capability decision as the planner: only an enabled manifest completion may reach usage/cache/provider.
    if (!(LOOKUP_JURISDICTIONS as readonly unknown[]).includes(lookup.jurisdiction)) { c.route = "preserve"; c.conflicts.push("lookup_jurisdiction_unsupported"); }
    else if (!rulepackCapability(String(lookup.kind), String(lookup.jurisdiction)).lookup) { c.route = "preserve"; c.conflicts.push("rulepack_lookup_disabled"); }
  }
  if (wire && readRulepackVersion((wire as { rulepackVersion?: unknown }).rulepackVersion) === "unsupported") {
    c.route = "preserve"; c.conflicts.push("rulepack_version_unsupported");
  }
  if (lookup && typeof lookup.rawInput === "string") {
    const lookupEvidence = buildPastedCitation(lookup.rawInput);
    if (lookupEvidence.route === "preserve" ||
      (lookupEvidence.jurisdiction !== "UNKNOWN" && c.jurisdiction !== "UNKNOWN" && lookupEvidence.jurisdiction !== c.jurisdiction) ||
      (lookupEvidence.jurisdiction !== "UNKNOWN" && ["US", "UK"].includes(String(lookup.jurisdiction)) && lookup.jurisdiction !== lookupEvidence.jurisdiction)) {
      c.route = "preserve"; c.conflicts.push("lookup_text_jurisdiction_conflict");
    }
  }
  if (manual?.subjurisdiction && c.jurisdiction === "UK" && manual.subjurisdiction !== "t2:united-kingdom/england-and-wales") {
    c.route = "preserve"; c.formatter = "unsupported"; c.unsupported.push("subjurisdiction_formatter_not_supported");
  }
  if (c.jurisdiction === "AU" || c.jurisdiction === "CA") { c.route = "preserve"; c.unsupported.push("country_local_only_completion_disabled"); }
  return c;
}