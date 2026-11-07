/**
 * Foreign case location records (Stage 2 of the foreign free-form plan). Pure, no IO.
 *
 * One record per reported location: reporter, volume, first page and the
 * report's own year travel together and are never mixed with another record.
 * Records are grouped into decisions (court, decision year, neutral citation)
 * BEFORE any location is selected. A decision year is kept separate from the
 * year that identifies a report volume.
 *
 * Reporter priority between parallel reports is NOT decided here: until the
 * edition-21 rule is verified by an authorised reader, two or more parallel
 * reporters for one decision are returned as a choice.
 *
 * Location forms are copied from the evidence (square / round / no bracket);
 * nothing is inferred from a reporter name.
 */
import { UK_REPORT_COURTS, normalizeReporter } from "./tables.ts";

export type CaseJurisdiction = "US" | "UK";
export type ReportYearStyle = "square" | "round" | "none";
export type CaseLocationBasis =
  | "official_record" | "structured_metadata" | "publisher_metadata"
  | "repository_metadata" | "search_result_explicit" | "document_inspection";

/** A location as found in one evidence text, before source attribution. */
export interface LocationHit {
  jurisdiction: CaseJurisdiction;
  reporter: string;
  /** US: volume number. UK: in-year volume number ("1" in "[1990] 1 WLR 1"). */
  volume?: string;
  firstPage: string;
  /** UK: the year that identifies the report volume ("[1932]", "(1878)", "1932 SC"). */
  volumeYear?: string;
  yearStyle?: ReportYearStyle;
  /** Court parenthetical attached to this location, when present. */
  court?: string;
}

/** One citation chain: consecutive locations that cite the same decision. */
export interface LocationChain {
  start: number;
  end: number;
  locations: LocationHit[];
  neutral?: string;
  /** Year of decision: neutral citation year or US decision parenthetical. */
  decisionYear?: string;
  court?: string;
}

export interface CaseLocationRecord extends LocationHit {
  id: string;
  sourceUrl: string;
  sourceTitle?: string;
  basis: CaseLocationBasis;
  /** Number of distinct sources that reported this exact location. */
  support: number;
}

export interface CaseDecisionRecord {
  id: string;
  jurisdiction: CaseJurisdiction;
  court?: string;
  decisionYear?: string;
  neutral?: string;
  neutralSourceUrl?: string;
  neutralSourceTitle?: string;
  neutralBasis?: CaseLocationBasis;
  /** Source of the decision-level court / decision year (first chain that stated it). */
  courtSource?: { url: string; title?: string; basis: CaseLocationBasis };
  decisionYearSource?: { url: string; title?: string; basis: CaseLocationBasis };
  locations: CaseLocationRecord[];
  sourceUrls: string[];
  /** Reporters whose own records disagree; those records are never merged or selected. */
  locationConflicts: string[];
}

export interface ChainEvidence {
  chain: LocationChain;
  sourceUrl: string;
  sourceTitle?: string;
  basis: CaseLocationBasis;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs: readonly string[]) => [...xs].sort((a, b) => b.length - a.length).map(esc).join("|");
const YEAR = String.raw`(?:17|18|19|20)\d{2}`;

/** Reports whose year is a square-bracketed volume identifier. */
export const UK_SQUARE_SERIES = [
  "AC", "QB", "KB", "Ch", "Fam", "P", "WLR", "All ER Rep", "All ER", "Lloyd's Rep",
  "ICR", "IRLR", "BCLC",
] as const;
/** Volume-numbered reports whose round-bracketed year is not part of the identifier. */
export const UK_ROUND_SERIES = ["App Cas", "QBD", "ChD", "Ch D", "PD", "Ex D", "CPD", "HL Cas", "Cr App R"] as const;
/** Scottish reports cited with an unbracketed year. */
export const UK_UNBRACKETED_SERIES = ["SC (HL)", "SC (PC)", "SC (J)", "SC", "SLT"] as const;

const COURT_PAREN = String.raw`(?:\s*\((${alt(UK_REPORT_COURTS)})\))?`;
const UK_SQUARE_RE = new RegExp(String.raw`\[(${YEAR})\]\s+(?:(\d{1,2})\s+)?(${alt(UK_SQUARE_SERIES)})\s+(\d{1,5})(?![\d])${COURT_PAREN}`, "g");
const UK_ROUND_RE = new RegExp(String.raw`\((${YEAR})\)\s+(\d{1,3})\s+(${alt(UK_ROUND_SERIES)})\s+(\d{1,5})(?![\d])${COURT_PAREN}`, "g");
const UK_NONE_RE = new RegExp(String.raw`(?<![\[(\d])(${YEAR})\s+(${alt(UK_UNBRACKETED_SERIES)})\s+(\d{1,5})(?![\d])`, "g");
const UK_NEUTRAL_RE = /\[((?:19|20)\d{2})\]\s+(UKSC|UKHL|UKPC|UKUT|EWCA\s+(?:Civ|Crim)|EWCA|EWHC)\s+(\d{1,5})(?:\s*\((Admin|Ch|Comm|Fam|QB|KB|TCC|Pat|IPEC)\))?/g;

const US_REPORTER = String.raw`[A-Z][A-Za-z0-9']*\.(?:\s*[A-Z][A-Za-z0-9']*\.?)*(?:\s*\d+(?:d|th|st|nd|rd))?`;
const US_LOC_RE = new RegExp(String.raw`(?<![\w.])(\d{1,4})\s+(${US_REPORTER})\s+(\d{1,5})(?![\d])`, "g");
const MONTH_TAIL = /,?\s*(?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*$/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

interface RawHit { start: number; end: number; hit?: LocationHit; neutral?: { year: string; body: string } }

function ukHits(text: string): RawHit[] {
  const out: RawHit[] = [];
  const push = (m: RegExpExecArray, hit?: LocationHit, neutral?: RawHit["neutral"]) =>
    out.push({ start: m.index, end: m.index + m[0].length, hit, neutral });
  for (const m of text.matchAll(UK_NEUTRAL_RE)) {
    push(m as RegExpExecArray, undefined, { year: m[1], body: `${collapse(m[2])} ${m[3]}${m[4] ? ` (${m[4]})` : ""}` });
  }
  for (const m of text.matchAll(UK_SQUARE_RE)) push(m as RegExpExecArray, {
    jurisdiction: "UK", volumeYear: m[1], volume: m[2], reporter: m[3], firstPage: m[4], court: m[5], yearStyle: "square",
  });
  for (const m of text.matchAll(UK_ROUND_RE)) push(m as RegExpExecArray, {
    jurisdiction: "UK", volumeYear: m[1], volume: m[2], reporter: collapse(m[3]), firstPage: m[4], court: m[5], yearStyle: "round",
  });
  for (const m of text.matchAll(UK_NONE_RE)) push(m as RegExpExecArray, {
    jurisdiction: "UK", volumeYear: m[1], reporter: m[2], firstPage: m[3], yearStyle: "none",
  });
  return out.sort((a, b) => a.start - b.start);
}

function usHits(text: string): RawHit[] {
  const out: RawHit[] = [];
  for (const m of text.matchAll(US_LOC_RE)) {
    const reporter = normalizeReporter(collapse(m[2]).replace(/^U\. S\.$/, "U.S."));
    if (!reporter) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, hit: { jurisdiction: "US", volume: m[1], reporter, firstPage: m[3] } });
  }
  return out;
}

/** Gap between two locations of the same chain: a comma, optionally after a pinpoint. */
const CHAIN_GAP = /^\s*(?:,\s*\d{1,5}(?:\s*[–-]\s*\d{1,5})?)?\s*[,;]\s*$/;
const UK_CHAIN_GAP = /^\s*(?:\[\d{1,4}\]|\d{1,5}(?:\s*[–-]\s*\d{1,5})?)?\s*[,;]\s*$/;
const US_PAREN_TAIL = /^(?:\s*,\s*\d{1,5}(?:\s*[–-]\s*\d{1,5})?)?\s*\(([^()]{0,60}?)\s*((?:17|18|19|20)\d{2})\)/;

/**
 * Extract citation chains from one evidence text. "On appeal from" lines cite
 * other decisions and are removed first.
 */
export function extractLocationChains(rawText: string, jurisdiction: CaseJurisdiction): LocationChain[] {
  const text = rawText.replace(/On appeals? from:[^\n]*/gi, (s) => " ".repeat(s.length));
  const hits = jurisdiction === "UK" ? ukHits(text) : usHits(text);
  const chains: LocationChain[] = [];
  let current: LocationChain | null = null;
  let prevEnd = -1;
  for (const h of hits) {
    if (h.start < prevEnd) continue; // overlapping alternative match
    const gap = current ? text.slice(prevEnd, h.start) : "";
    const joins = current && (jurisdiction === "UK" ? UK_CHAIN_GAP : CHAIN_GAP).test(gap) &&
      !(jurisdiction === "US" && current.decisionYear);
    if (!joins) {
      if (current) chains.push(current);
      current = { start: h.start, end: h.end, locations: [] };
    }
    const c = current!;
    c.end = h.end;
    if (h.neutral) {
      if (c.neutral && c.neutral !== h.neutral.body) { chains.push(c); current = { start: h.start, end: h.end, locations: [] }; }
      current!.neutral = h.neutral.body;
      current!.decisionYear = h.neutral.year;
    }
    if (h.hit) current!.locations.push(h.hit);
    prevEnd = h.end;
    if (jurisdiction === "US") {
      const tail = US_PAREN_TAIL.exec(text.slice(h.end));
      if (tail) {
        const court = collapse(tail[1].replace(MONTH_TAIL, "")).replace(/,$/, "");
        current!.decisionYear = tail[2];
        if (court) current!.court = court;
        current!.end = h.end + tail[0].length;
        prevEnd = current!.end;
      }
    }
  }
  if (current) chains.push(current);
  for (const c of chains) {
    if (jurisdiction === "UK") {
      const courts = [...new Set(c.locations.map((l) => l.court).filter(Boolean))];
      if (courts.length === 1) c.court = courts[0];
    }
  }
  // A US location without its decision parenthetical carries no decision year.
  return chains.filter((c) => c.neutral || (c.locations.length > 0 && (jurisdiction === "UK" || c.decisionYear)));
}

const CAPTION_V = /\s(?:v\.?|vs\.?)\s/g;

/**
 * Bind each chain of ONE text to the target case. A chain belongs to the
 * nearest preceding "v" caption in the same text, which must name both
 * parties. A chain with no new caption since the previous chain inherits that
 * chain's binding; the first chain with no caption at all uses
 * `noCaptionBound` (e.g. the source title itself is the target caption).
 */
export function bindChainsToCaption(
  text: string,
  chains: LocationChain[],
  hasParty: (t: string, which: 0 | 1) => boolean,
  noCaptionBound: boolean,
): boolean[] {
  const out: boolean[] = [];
  let prevEnd = 0;
  let prevBound = noCaptionBound;
  for (const chain of chains) {
    const segment = text.slice(prevEnd, chain.start);
    const vs = [...segment.matchAll(CAPTION_V)];
    const last = vs[vs.length - 1];
    let bound: boolean;
    if (!last) bound = prevBound;
    else {
      const left = segment.slice(0, last.index!);
      const right = segment.slice(last.index!);
      bound = hasParty(left, 0) && hasParty(right, 1);
    }
    out.push(bound);
    prevBound = bound;
    prevEnd = chain.end;
  }
  return out;
}

const normCourt = (s?: string) => (s ?? "").toLowerCase().replace(/[.\s]/g, "");
export const locationId = (l: LocationHit) =>
  `${l.jurisdiction}|${l.reporter.toLowerCase().replace(/[^a-z0-9]/g, "")}|${l.volumeYear ?? ""}|${l.volume ?? ""}|${l.firstPage}`;
const seriesKey = (l: LocationHit) => `${l.jurisdiction}|${l.reporter.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const effYear = (g: { decisionYear?: string; locations: LocationHit[] }) =>
  g.decisionYear ?? (() => { const ys = [...new Set(g.locations.map((l) => l.volumeYear).filter(Boolean))]; return ys.length === 1 ? ys[0] : undefined; })();

interface Group { court?: string; decisionYear?: string; neutral?: string; chains: ChainEvidence[]; locations: LocationHit[] }

function compatible(a: Group, b: Group): boolean {
  if (a.court && b.court && normCourt(a.court) !== normCourt(b.court)) return false;
  if (a.neutral && b.neutral && a.neutral !== b.neutral) return false;
  if (a.decisionYear && b.decisionYear && a.decisionYear !== b.decisionYear) return false;
  const ya = effYear(a), yb = effYear(b);
  if (ya && yb && ya !== yb) return false;
  return true;
}
function linked(a: Group, b: Group): boolean {
  if (a.neutral && a.neutral === b.neutral) return true;
  const ids = new Set(a.locations.map(locationId));
  if (b.locations.some((l) => ids.has(locationId(l)))) return true;
  const ya = effYear(a), yb = effYear(b);
  return !!ya && ya === yb;
}

/** Group identity-bound chains into decisions; incompatible attributes never merge. */
export function groupCaseDecisions(evidence: ChainEvidence[], jurisdiction: CaseJurisdiction): CaseDecisionRecord[] {
  const groups: Group[] = evidence.map((e) => ({
    court: e.chain.court, decisionYear: e.chain.decisionYear, neutral: e.chain.neutral,
    chains: [e], locations: [...e.chain.locations],
  }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (compatible(groups[i], groups[j]) && linked(groups[i], groups[j])) {
          const a = groups[i], b = groups[j];
          groups[i] = {
            court: a.court ?? b.court, decisionYear: a.decisionYear ?? b.decisionYear, neutral: a.neutral ?? b.neutral,
            chains: [...a.chains, ...b.chains], locations: [...a.locations, ...b.locations],
          };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups.map((g) => {
    const byId = new Map<string, CaseLocationRecord>();
    const sources = new Map<string, Set<string>>();
    let neutralDonor: ChainEvidence | undefined;
    for (const e of g.chains) {
      if (g.neutral && e.chain.neutral === g.neutral && !neutralDonor) neutralDonor = e;
      for (const l of e.chain.locations) {
        const id = locationId(l);
        const seen = sources.get(id) ?? new Set<string>();
        seen.add(e.sourceUrl);
        sources.set(id, seen);
        if (!byId.has(id)) byId.set(id, { ...l, id, sourceUrl: e.sourceUrl, sourceTitle: e.sourceTitle, basis: e.basis, support: 0 });
      }
    }
    const locations = [...byId.values()].map((l) => ({ ...l, support: sources.get(l.id)!.size }));
    const conflicts: string[] = [];
    const bySeries = new Map<string, CaseLocationRecord[]>();
    for (const l of locations) bySeries.set(seriesKey(l), [...(bySeries.get(seriesKey(l)) ?? []), l]);
    for (const list of bySeries.values()) {
      if (list.length > 1) conflicts.push(`location:${list.map(formatLocationLabel).join(" vs ")}`);
    }
    const donor = (pick: (c: LocationChain) => string | undefined) => {
      const e = g.chains.find((c) => pick(c.chain));
      return e ? { url: e.sourceUrl, ...(e.sourceTitle ? { title: e.sourceTitle } : {}), basis: e.basis } : undefined;
    };
    const courtSource = g.court ? donor((c) => c.court) : undefined;
    const decisionYearSource = g.decisionYear ? donor((c) => c.decisionYear) : undefined;
    const sortedIds = locations.map((l) => l.id).sort();
    return {
      ...(courtSource ? { courtSource } : {}),
      ...(decisionYearSource ? { decisionYearSource } : {}),
      id: `dec:${jurisdiction}|${g.neutral ?? ""}|${normCourt(g.court)}|${g.decisionYear ?? ""}|${sortedIds[0] ?? ""}`,
      jurisdiction,
      ...(g.court ? { court: g.court } : {}),
      ...(g.decisionYear ? { decisionYear: g.decisionYear } : {}),
      ...(g.neutral ? { neutral: g.neutral, neutralSourceUrl: neutralDonor?.sourceUrl, neutralSourceTitle: neutralDonor?.sourceTitle, neutralBasis: neutralDonor?.basis } : {}),
      locations,
      sourceUrls: [...new Set(g.chains.map((c) => c.sourceUrl))],
      locationConflicts: conflicts,
    };
  });
}

/** Locations usable for selection: reporters whose own records disagree are dropped. */
export function selectableLocations(d: CaseDecisionRecord): CaseLocationRecord[] {
  const bad = new Set<string>();
  const bySeries = new Map<string, number>();
  for (const l of d.locations) bySeries.set(seriesKey(l), (bySeries.get(seriesKey(l)) ?? 0) + 1);
  for (const [k, n] of bySeries) if (n > 1) bad.add(k);
  return d.locations.filter((l) => !bad.has(seriesKey(l)));
}

/**
 * Renderer field names for one decision and (optionally) one location. Every
 * location field comes from that single record; the decision year stays out
 * of a UK report-year slot unless the renderer's own neutral form uses it.
 */
export type FieldDonor = "location" | "neutral" | "court" | "decisionYear";
export function decisionLocationFields(d: CaseDecisionRecord, l?: CaseLocationRecord): { fields: Record<string, string>; donors: Record<string, FieldDonor> } {
  const fields: Record<string, string> = {};
  const donors: Record<string, FieldDonor> = {};
  const set = (k: string, v: string | undefined, donor: FieldDonor) => { if (v) { fields[k] = v; donors[k] = donor; } };
  const report = (loc: CaseLocationRecord) => {
    set("reporter", loc.reporter, "location");
    set("firstPage", loc.firstPage, "location");
    if (loc.yearStyle && loc.yearStyle !== "square") set("reportYearStyle", loc.yearStyle, "location");
  };
  if (d.jurisdiction === "US") {
    if (l) { set("volume", l.volume, "location"); report(l); }
    set("court", d.court, "court");
    set("year", d.decisionYear, "decisionYear");
    return { fields, donors };
  }
  if (d.neutral) {
    set("neutral", d.neutral, "neutral");
    set("year", d.decisionYear, "neutral");
    if (l) {
      report(l);
      set("reporterVolume", l.volume, "location");
      if (l.volumeYear !== d.decisionYear) set("volume", l.volumeYear, "location");
    }
    return { fields, donors };
  }
  if (l) {
    report(l);
    set("reporterVolume", l.volume, "location");
    set("year", l.volumeYear, "location");
    if (l.court) set("court", l.court, "location");
    else set("court", d.court, "court");
  }
  return { fields, donors };
}

/** Display text for one location exactly in its reported form. */
export function formatLocationLabel(l: LocationHit): string {
  if (l.jurisdiction === "US") return `${l.volume} ${l.reporter} ${l.firstPage}`;
  const vol = l.volume ? `${l.volume} ` : "";
  const year = l.yearStyle === "round" ? `(${l.volumeYear})` : l.yearStyle === "none" ? `${l.volumeYear}` : `[${l.volumeYear}]`;
  return `${year} ${vol}${l.reporter} ${l.firstPage}${l.court ? ` (${l.court})` : ""}`;
}

export interface LocationChoiceOption { id: string; label: string; url: string }

/**
 * Validate an untrusted lookup response that asks the user to choose between
 * parallel reports of ONE decision. Returns null for anything malformed.
 */
export function readLocationChoice(response: unknown, jurisdiction: string | null): LocationChoiceOption[] | null {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;
  if (r.locationChoiceRequired !== true || !Array.isArray(r.caseDecisions) || r.caseDecisions.length !== 1) return null;
  const d = r.caseDecisions[0] as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.jurisdiction !== jurisdiction || !Array.isArray(d.locations)) return null;
  const options: LocationChoiceOption[] = [];
  // Reporters whose own records disagree are never offered (same rule as selectableLocations).
  const seriesCount = new Map<string, number>();
  for (const raw of d.locations) {
    const l = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (typeof l.reporter === "string") {
      const k = seriesKey({ jurisdiction: jurisdiction as CaseJurisdiction, reporter: l.reporter, firstPage: "" });
      seriesCount.set(k, (seriesCount.get(k) ?? 0) + 1);
    }
  }
  for (const raw of d.locations) {
    if (!raw || typeof raw !== "object") return null;
    const l = raw as Record<string, unknown>;
    const str = (k: string) => typeof l[k] === "string" && (l[k] as string).trim() ? l[k] as string : undefined;
    if (!str("id") || !str("reporter") || !str("firstPage") || !str("sourceUrl") || l.jurisdiction !== jurisdiction) return null;
    if (jurisdiction === "US" && !str("volume")) return null;
    if (jurisdiction === "UK" && (!str("volumeYear") || !["square", "round", "none"].includes(String(l.yearStyle)))) return null;
    try { if (!["https:", "http:"].includes(new URL(str("sourceUrl")!).protocol)) return null; } catch { return null; }
    if ((seriesCount.get(seriesKey({ jurisdiction: jurisdiction as CaseJurisdiction, reporter: str("reporter")!, firstPage: "" })) ?? 0) > 1) continue;
    options.push({
      id: str("id")!,
      label: formatLocationLabel({
        jurisdiction: jurisdiction as CaseJurisdiction, reporter: str("reporter")!, firstPage: str("firstPage")!,
        volume: str("volume"), volumeYear: str("volumeYear"), yearStyle: l.yearStyle as ReportYearStyle | undefined, court: str("court"),
      }),
      url: str("sourceUrl")!,
    });
  }
  return options.length > 1 ? options : null;
}

/** One line describing a decision for a choice list. */
export function decisionLabel(d: CaseDecisionRecord): string {
  const parts = [
    ...(d.neutral && d.decisionYear ? [`[${d.decisionYear}] ${d.neutral}`] : []),
    ...d.locations.slice(0, 3).map(formatLocationLabel),
  ];
  const paren = d.jurisdiction === "US" ? [d.court, d.decisionYear].filter(Boolean).join(" ") : "";
  return `${parts.join(", ")}${paren ? ` (${paren})` : ""}`.slice(0, 160);
}

export interface GroundedProvenance { value: string; sourceUrl: string; sourceTitle?: string; basis: CaseLocationBasis }
/**
 * Lookup-response fields for one decision and (optionally) one of its
 * locations, each tied to the source that stated it. Shared by the server
 * lookup and by a user's choice in the app, so both ground fields identically.
 * A field equal to the user's own year is the user's anchor, not a new fact.
 */
export function groundDecisionFields(d: CaseDecisionRecord, chosen: CaseLocationRecord | undefined, userYear?: string): {
  fields: Record<string, string>; grounded: Record<string, true>; provenance: Record<string, GroundedProvenance>;
} {
  const out = { fields: {} as Record<string, string>, grounded: {} as Record<string, true>, provenance: {} as Record<string, GroundedProvenance> };
  const { fields, donors } = decisionLocationFields(d, chosen);
  for (const [field, value] of Object.entries(fields)) {
    if (field === "year" && userYear === value) continue;
    const donor = donors[field] === "location" ? (chosen && { url: chosen.sourceUrl, title: chosen.sourceTitle, basis: chosen.basis })
      : donors[field] === "neutral" ? (d.neutralSourceUrl && d.neutralBasis ? { url: d.neutralSourceUrl, title: d.neutralSourceTitle, basis: d.neutralBasis } : undefined)
      : donors[field] === "court" ? d.courtSource
      : d.decisionYearSource;
    if (!donor) continue;
    out.fields[field] = value;
    out.grounded[field] = true;
    out.provenance[field] = { value, sourceUrl: donor.url, sourceTitle: donor.title, basis: donor.basis };
  }
  return out;
}

const BASES: readonly CaseLocationBasis[] = ["official_record", "structured_metadata", "publisher_metadata", "repository_metadata", "search_result_explicit", "document_inspection"];
const httpUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { return ["https:", "http:"].includes(new URL(v).protocol); } catch { return false; }
};
const optStr = (o: Record<string, unknown>, k: string): string | undefined | null =>
  o[k] === undefined ? undefined : typeof o[k] === "string" && (o[k] as string).trim() ? o[k] as string : null;
const basis = (v: unknown): CaseLocationBasis | null => BASES.includes(v as CaseLocationBasis) ? v as CaseLocationBasis : null;
function readDonor(v: unknown): { url: string; title?: string; basis: CaseLocationBasis } | undefined | null {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const b = basis(o.basis), title = optStr(o, "title");
  if (!httpUrl(o.url) || !b || title === null) return null;
  return { url: o.url, ...(title ? { title } : {}), basis: b };
}

/**
 * Validate one untrusted decision record from a lookup response and return a
 * clean copy with only known fields. Any malformed part rejects the record.
 */
export function readDecisionRecord(raw: unknown, jurisdiction: CaseJurisdiction): CaseDecisionRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || !d.id || d.jurisdiction !== jurisdiction || !Array.isArray(d.locations)) return null;
  const court = optStr(d, "court"), decisionYear = optStr(d, "decisionYear"), neutral = optStr(d, "neutral");
  if (court === null || decisionYear === null || neutral === null) return null;
  if (decisionYear !== undefined && !/^(?:17|18|19|20)\d{2}$/.test(decisionYear)) return null;
  const courtSource = readDonor(d.courtSource), decisionYearSource = readDonor(d.decisionYearSource);
  if (courtSource === null || decisionYearSource === null) return null;
  let neutralPart: Partial<CaseDecisionRecord> = {};
  if (neutral) {
    const t = optStr(d, "neutralSourceTitle");
    const nb = d.neutralBasis === undefined ? undefined : basis(d.neutralBasis);
    if (t === null || nb === null || (d.neutralSourceUrl !== undefined && !httpUrl(d.neutralSourceUrl))) return null;
    neutralPart = { neutral, ...(httpUrl(d.neutralSourceUrl) ? { neutralSourceUrl: d.neutralSourceUrl } : {}), ...(t ? { neutralSourceTitle: t } : {}), ...(nb ? { neutralBasis: nb } : {}) };
  }
  const locations: CaseLocationRecord[] = [];
  for (const rl of d.locations) {
    if (!rl || typeof rl !== "object") return null;
    const l = rl as Record<string, unknown>;
    const id = optStr(l, "id"), reporter = optStr(l, "reporter"), firstPage = optStr(l, "firstPage");
    const volume = optStr(l, "volume"), volumeYear = optStr(l, "volumeYear"), lcourt = optStr(l, "court"), title = optStr(l, "sourceTitle");
    const b = basis(l.basis);
    if (!id || !reporter || !firstPage || volume === null || volumeYear === null || lcourt === null || title === null || !b) return null;
    if (l.jurisdiction !== jurisdiction || !httpUrl(l.sourceUrl) || typeof l.support !== "number" || !(l.support >= 1)) return null;
    if (jurisdiction === "US" && !volume) return null;
    if (jurisdiction === "UK" && (!volumeYear || !["square", "round", "none"].includes(String(l.yearStyle)))) return null;
    const rec: CaseLocationRecord = {
      jurisdiction, reporter, firstPage, ...(volume ? { volume } : {}), ...(volumeYear ? { volumeYear } : {}),
      ...(l.yearStyle !== undefined ? { yearStyle: l.yearStyle as ReportYearStyle } : {}), ...(lcourt ? { court: lcourt } : {}),
      id, sourceUrl: l.sourceUrl, ...(title ? { sourceTitle: title } : {}), basis: b, support: l.support,
    };
    if (locationId(rec) !== id) return null; // the id must name exactly these fields
    locations.push(rec);
  }
  if (!Array.isArray(d.sourceUrls) || !d.sourceUrls.every(httpUrl)) return null;
  if (!Array.isArray(d.locationConflicts) || !d.locationConflicts.every((c) => typeof c === "string" && c.startsWith("location:"))) return null;
  if (!neutral && locations.length === 0) return null;
  return {
    id: d.id, jurisdiction,
    ...(court ? { court } : {}), ...(decisionYear ? { decisionYear } : {}), ...neutralPart,
    ...(courtSource ? { courtSource } : {}), ...(decisionYearSource ? { decisionYearSource } : {}),
    locations, sourceUrls: [...d.sourceUrls as string[]], locationConflicts: [...d.locationConflicts as string[]],
  };
}
