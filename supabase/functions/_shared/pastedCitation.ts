/** Batch A: pure supplied-text evidence, shared by browser and server. No I/O or identity claims. */
import { CASE_DOCKET_RE, findBareDocket } from "./caseTypePrefixes.ts";
export const PASTED_CITATION_VERSION = 1 as const;
export type CitationJurisdiction = "IL" | "US" | "UK" | "DE" | "UNKNOWN";
export interface InputSpan { start: number; end: number }
export interface SuppliedField {
  value: string | null;
  state: "supplied" | "unknown";
  provenance: "supplied_text" | "existing_parser" | "none";
  spans: InputSpan[];
}
export interface CitationManualChoice { jurisdiction?: CitationJurisdiction; subjurisdiction?: string; sourceType?: string; foreign?: boolean }
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
    for (const m of raw.matchAll(new RegExp(re.source, "g"))) {
      const span = { start: m.index, end: m.index + m[0].length };
      evidence.push({ jurisdiction, signal, span });
      if (signal === "court" || signal === "reporter") candidates[signal].push(field(raw, m[0], "supplied_text"));
    }
  };
  // Bounded explicit signals, not a country dictionary or language detector.
  add(/\bBVerfG\b|\bBvR\b/, "DE", "court");
  add(/\bBVerfGE\b/, "DE", "reporter");
  add(/\bU\.\s?S\.(?!\s?C\.)|\bF\.\s?(?:2d|3d|4th|Supp\.)/, "US", "reporter");
  add(/\b(?:D\. Mass\.|S\.D\.N\.Y\.|\d+(?:st|nd|rd|th) Cir\.)/, "US", "court");
  add(/\bU\.\s?S\.\s?C\.|\bU\.\s?S\.\s?CONST\./, "US", "code");
  add(/\b(?:UKSC|UKHL|UKPC|EWCA|EWHC)\b/, "UK", "court");
  add(/\b(?:WLR|All ER)\b/, "UK", "reporter");
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
  const unsupported = jurisdiction === "DE" ? ["formatter_DE_not_supported"] :
    manual?.jurisdiction === "UNKNOWN" && manual.subjurisdiction && caseInput ? ["jurisdiction_formatter_unknown"] : [];
  const route = conflicts.length || unsupported.length || (!!bare && detected === "UNKNOWN" && !foreignShape)
    ? "preserve" : detected === "IL" ? "israeli" : detected !== "UNKNOWN" || foreignShape || manual?.foreign ? "foreign" : "existing";
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
    sourceKind: parser?.kind ?? (caseInput ? "case" : null), jurisdiction, subjurisdiction, subjurisdictionEvidence,
    evidence, candidates, manualChoice: manual, fields, unknownSpans,
    classification: conflicts.length ? "conflicting" : detected === "IL" ? "identified_israeli" : detected !== "UNKNOWN" ? "identified_foreign" : "ambiguous",
    formatter: unsupported.length ? "unsupported" : jurisdiction === "UNKNOWN" ? "unknown" : "existing_route",
    missing, conflicts, unsupported, identityVerified: false, route };
}
export function pastedCitationWarning(c: PastedCitationContract): string {
  return c.conflicts.length ? "הסיווג שנבחר או פרטי השיפוט סותרים את הקלט; נשמר המקור שסופק ללא השלמה."
    : c.unsupported.length ? "עיצוב האזכור בתחום השיפוט שזוהה אינו נתמך; הקלט נשמר, וזהות המקור לא אומתה."
    : "חסרה ראיה לתחום השיפוט או לפרטי המקור; הקלט נשמר ללא אימות. יש לציין ערכאה או תחום שיפוט.";
}
/** Derive from supplied messages as well as rawInput: client declarations never override text evidence. */
export function guardPastedCitationRequest(body: { messages: Array<{ role: string; content: string }>; rawInput?: unknown; foreignLookup?: unknown; pastedCitation?: unknown }) {
  const last = [...body.messages].reverse().find(m => m.role === "user")?.content ?? "";
  const manualLine = last.match(/\[סיווג שיפוט ידני: (\{[^\n]*\})\]/)?.[1];
  const stripped = last.replace(/══[\s\S]*?═{3,}/g, "").replace(/\[[^\]\n]*(?:סיווג|כלל רלוונטי)[^\]\n]*\]\s*/g, "").trim();
  const raw = typeof body.rawInput === "string" ? body.rawInput : stripped;
  const wire = body.pastedCitation as Partial<PastedCitationContract> | undefined;
  let retainedChoice: CitationManualChoice | null = null;
  if (manualLine) { try { retainedChoice = JSON.parse(manualLine); } catch { /* malformed choice is not evidence */ } }
  const choice = wire?.version === 1 ? wire.manualChoice : retainedChoice;
  const manual = choice && typeof choice === "object" && !Array.isArray(choice) ? {
    ...(typeof choice.jurisdiction === "string" && ["IL", "US", "UK", "DE", "UNKNOWN"].includes(choice.jurisdiction) ? { jurisdiction: choice.jurisdiction } : {}),
    ...(typeof choice.subjurisdiction === "string" ? { subjurisdiction: choice.subjurisdiction } : {}),
    ...(typeof choice.sourceType === "string" ? { sourceType: choice.sourceType } : {}),
    ...(typeof choice.foreign === "boolean" ? { foreign: choice.foreign } : {}),
  } : null;
  const c = buildPastedCitation(raw, manual);
  const messageEvidence = buildPastedCitation(stripped);
  if (messageEvidence.route === "preserve" || (messageEvidence.classification === "identified_foreign" && c.classification === "identified_israeli")) {
    c.route = "preserve"; c.conflicts.push("request_text_conflict");
  }
  if (wire && (wire.version !== 1 || wire.fingerprint !== c.fingerprint || wire.rawInput !== raw)) {
    c.route = "preserve"; c.conflicts.push("contract_input_mismatch");
  }
  const lookup = body.foreignLookup as { rawInput?: unknown; kind?: unknown; jurisdiction?: unknown } | null;
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
  return c;
}