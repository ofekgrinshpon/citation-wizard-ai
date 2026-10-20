/**
 * Stage 4 — pure statute request/response adapter shared by runCitation
 * (batch/bibliography) and the chat page. No classifier, cache, provider or
 * billing calls.
 *
 * Supported bound: US and UK statutes with the existing renderers only. The
 * effective (manual) jurisdiction is never crossed; a contradicting
 * deterministic detection is an honest mismatch. Lookup fields are merged only
 * from a versioned, identity-matched, conflict-free response for the SAME
 * jurisdiction, and only to fill gaps the user left. Everything else keeps the
 * supplied input with a warning — model content is never trusted here.
 */
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { detectForeignSource } from "@/data/bluebook/extract";
import { renderForeignDetection } from "@/data/bluebook";
import { toForeignIdentity, type ForeignFields } from "@/data/bluebook/types";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import { getMissingFieldsSummary } from "@/lib/citationValidation";

export const STATUTE_RESPONSE_VERSION = 1 as const;
export type StatuteJurisdiction = "US" | "UK";

export interface ForeignStatuteRequest {
  enabled: true;
  statuteResponseVersion: typeof STATUTE_RESPONSE_VERSION;
  kind: "statute";
  jurisdiction: StatuteJurisdiction;
  rawInput: string;
  parsedFields: Record<string, string>;
}

export interface ForeignStatuteLookupResponse {
  statuteResponseVersion?: unknown;
  kind?: unknown;
  error?: unknown;
  identity?: { matched?: unknown; jurisdiction?: unknown; conflicts?: unknown };
  fields?: unknown;
}

type StatuteFieldValue = string | string[] | boolean;

export interface StatutePreparation {
  sourceType: SourceType;
  jurisdiction: StatuteJurisdiction;
  rawInput: string;
  /** Supplied fields only (identity anchors); never lookup output. */
  fields: Record<string, StatuteFieldValue>;
  outcome: "local" | "lookup" | "mismatch";
  detectedJurisdiction?: string;
  request?: ForeignStatuteRequest;
}

export interface StatuteRenderResult {
  citation: string;
  reply: string;
  status: "valid" | "warning";
  warningMsg?: string;
  sourceType: SourceType;
  sourceLabel: string;
}

const YEAR = String.raw`(?:1[6-9]|20)\d{2}`;
// A section sign: §, §§, s., ss., sec., secs., section(s). Must follow start,
// whitespace or a comma so a name's own letters are never read as "s.".
const SECTION_SIGN_RE = /(^|[\s,])(§§?|ss?\.|secs?\.|sections?\b)\s*/i;
const SECTION_TOKEN = String.raw`[0-9][0-9A-Za-z.\-]*(?:\([0-9A-Za-z]+\))*`;
const SECTION_ITEM_RE = new RegExp(String.raw`^\s*(${SECTION_TOKEN})(?:\s*(?:–|\bto\b)\s*(${SECTION_TOKEN}))?`);

export function statuteJurisdictionOf(sourceType: SourceType): StatuteJurisdiction | null {
  const id = toForeignIdentity(sourceType);
  return id?.kind === "statute" && (id.jurisdiction === "US" || id.jurisdiction === "UK") ? id.jurisdiction : null;
}

/**
 * Parse supplied statute details for ONE jurisdiction. Years are read only in
 * a dated context (UK "Name Act YEAR"; US parenthesised code edition year),
 * never from a section/title/chapter number. Unparsed tails are preserved.
 */
export function parseStatuteInput(raw: string, jurisdiction: StatuteJurisdiction): Record<string, StatuteFieldValue> {
  const text = raw.replace(/\s+/g, " ").trim();
  const fields: Record<string, StatuteFieldValue> = {};
  const sign = SECTION_SIGN_RE.exec(text);
  let head = (sign ? text.slice(0, sign.index + sign[1].length) : text).trim().replace(/[,\s]+$/, "");
  const signText = sign?.[2];
  let tail = sign ? text.slice(sign.index + sign[0].length) : "";

  if (jurisdiction === "US") {
    const code = head.match(/^(.*?)(?:,\s*)?\b(\d{1,3})\s+(U\.\s?S\.\s?C\.(?:\s?A\.)?)$/);
    if (code) {
      head = code[1].trim().replace(/[,\s]+$/, "");
      fields.titleNumber = code[2];
      fields.code = code[3].replace(/\s+/g, "");
    }
  } else {
    const named = head.match(new RegExp(String.raw`^(.*?\b(?:Act|Measure|Order))\s+(${YEAR})(?:\s*,\s*c\.\s*(\w+))?\.?$`));
    if (named) {
      head = named[1].trim();
      fields.year = named[2];
      if (named[3]) fields.chapter = named[3];
    }
  }
  if (/[A-Za-z]{3}/.test(head)) fields.statuteName = head;
  else if (head) fields.unparsedRemainder = head;

  if (sign) {
    if (jurisdiction === "US") {
      const y = tail.match(new RegExp(String.raw`\s*\((${YEAR})\)\s*\.?\s*$`));
      if (y) { fields.year = y[1]; tail = tail.slice(0, y.index); }
    }
    const items: string[] = [];
    let rest = tail;
    let hasRange = false;
    for (;;) {
      const m = SECTION_ITEM_RE.exec(rest);
      if (!m) break;
      let item = m[2] ? `${m[1]}–${m[2]}` : m[1];
      const hy = item.match(/^(\d+)-(\d+)$/);
      if (hy) item = `${hy[1]}–${hy[2]}`;
      hasRange ||= item.includes("–");
      items.push(item);
      rest = rest.slice(m[0].length);
      const comma = rest.match(/^\s*,\s*(?=\d)/);
      if (!comma) break;
      rest = rest.slice(comma[0].length);
    }
    const leftover = rest.replace(/^[\s,;]+/, "").replace(/[\s.]+$/, "");
    const plural = /^(§§|ss\.|secs\.|sections)$/i.test(signText ?? "");
    if (jurisdiction === "US" && items.length) {
      if (items.length === 1) fields.section = items[0];
      else fields.sections = items;
      if (plural || hasRange) fields.multi = true;
      if (leftover) fields.unparsedRemainder = [fields.unparsedRemainder, leftover].filter(Boolean).join(" ");
    } else if (jurisdiction === "UK" && items.length === 1 && !hasRange && !plural && !leftover) {
      fields.section = items[0];
    } else {
      // Lists, ranges or unparsed section text the UK template cannot represent
      // are kept verbatim; prepareForeignStatute then declines the item.
      const verbatim = `${signText} ${tail}`.replace(/\s+/g, " ").trim().replace(/\.$/, "");
      fields.unparsedRemainder = [fields.unparsedRemainder, verbatim].filter(Boolean).join(" ");
    }
  }
  return fields;
}

function renderFields(jurisdiction: StatuteJurisdiction, sourceType: SourceType, fields: Record<string, StatuteFieldValue>) {
  return renderForeignDetection({
    sourceType, kind: "statute", jurisdiction, confidence: "deterministic",
    fields: fields as unknown as ForeignFields,
  });
}

function requestFields(fields: Record<string, StatuteFieldValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["statuteName", "titleNumber", "code", "section", "year", "chapter"] as const) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  if (Array.isArray(fields.sections) && fields.sections.length) out.sections = fields.sections.join(", ");
  return out;
}

/**
 * Rebuild the preparation from a retained typed request (read-only recovery).
 * Uses only the request's own supplied fields; null when it is not a valid
 * supported statute request.
 */
export function statutePreparationFromRequest(request: unknown): StatutePreparation | null {
  const r = request && typeof request === "object" ? request as Record<string, unknown> : null;
  if (!r || r.kind !== "statute" || r.statuteResponseVersion !== STATUTE_RESPONSE_VERSION) return null;
  if ((r.jurisdiction !== "US" && r.jurisdiction !== "UK") || typeof r.rawInput !== "string") return null;
  const pf = r.parsedFields && typeof r.parsedFields === "object" ? r.parsedFields as Record<string, unknown> : {};
  const fields: Record<string, StatuteFieldValue> = {};
  for (const k of ["statuteName", "titleNumber", "code", "section", "year", "chapter"]) {
    if (typeof pf[k] === "string" && (pf[k] as string).trim()) fields[k] = (pf[k] as string).trim();
  }
  if (typeof pf.sections === "string") {
    const list = pf.sections.split(",").map((x) => x.trim()).filter(Boolean);
    if (list.length) fields.sections = list;
  }
  const jurisdiction = r.jurisdiction;
  return {
    sourceType: jurisdiction === "US" ? "foreign_statute_us" : "foreign_statute_uk", jurisdiction, rawInput: r.rawInput, fields, outcome: "lookup",
    request: { enabled: true, statuteResponseVersion: STATUTE_RESPONSE_VERSION, kind: "statute", jurisdiction, rawInput: r.rawInput, parsedFields: requestFields(fields) },
  };
}

/**
 * Prepare a statute item. Returns null when the source type is not a
 * supported statute, or when no manual choice applies and a deterministic
 * detection of another kind/jurisdiction should keep the existing route.
 */
export function prepareForeignStatute(
  sourceType: SourceType,
  rawInput: string,
  opts: { manual?: boolean } = {},
): StatutePreparation | null {
  const jurisdiction = statuteJurisdictionOf(sourceType);
  if (!jurisdiction) return null;
  const raw = rawInput.trim();
  const detection = detectForeignSource(raw);
  if (detection && detection.confidence === "deterministic" && detection.kind === "statute") {
    if (detection.jurisdiction === jurisdiction) {
      return { sourceType, jurisdiction, rawInput: raw, fields: detection.fields as unknown as Record<string, StatuteFieldValue>, outcome: "local" };
    }
    if (!opts.manual) return null;
    return { sourceType, jurisdiction, rawInput: raw, fields: {}, outcome: "mismatch", detectedJurisdiction: detection.jurisdiction };
  }
  const fields = parseStatuteInput(raw, jurisdiction);
  // Unsupported or malformed tails are never truncated or reformatted here:
  // the whole input keeps its existing declined-input fallback route.
  if (fields.unparsedRemainder !== undefined) return null;
  const rendered = renderFields(jurisdiction, sourceType, fields);
  const complete = !!rendered && rendered.missing.length === 0 && (jurisdiction === "US" || !!fields.year);
  if (complete || typeof fields.statuteName !== "string") {
    return { sourceType, jurisdiction, rawInput: raw, fields, outcome: "local" };
  }
  return {
    sourceType, jurisdiction, rawInput: raw, fields, outcome: "lookup",
    request: {
      enabled: true, statuteResponseVersion: STATUTE_RESPONSE_VERSION, kind: "statute",
      jurisdiction, rawInput: raw, parsedFields: requestFields(fields),
    },
  };
}

const JUR_LABEL: Record<string, string> = { US: "ארה״ב", UK: "בריטניה" };

function build(prep: StatutePreparation, fields: Record<string, StatuteFieldValue>, extra: string[]): StatuteRenderResult {
  const rendered = renderFields(prep.jurisdiction, prep.sourceType, fields);
  const warnings = [...(rendered?.warnings ?? []), ...extra];
  const citation = rendered?.citation.trim() ? rendered.citation : escapeCitationLiteral(prep.rawInput);
  if (rendered?.missing.length) warnings.push(`חסרים פרטים: ${getMissingFieldsSummary(prep.sourceType, rendered.missing)}`);
  return {
    citation,
    reply: warnings.length ? `${citation}\n⚠️ ${warnings.join(" ")}` : citation,
    status: warnings.length ? "warning" : "valid",
    warningMsg: warnings[0],
    sourceType: prep.sourceType,
    sourceLabel: SOURCE_TYPE_LABELS[prep.sourceType],
  };
}

/** Local (no-network) result: complete supplied input, or an honest mismatch. */
export function renderStatuteLocal(prep: StatutePreparation): StatuteRenderResult {
  if (prep.outcome === "mismatch") {
    const citation = escapeCitationLiteral(prep.rawInput);
    const warning = `הסיווג שנבחר (${SOURCE_TYPE_LABELS[prep.sourceType]}) סותר את צורת האזכור שזוהתה (${JUR_LABEL[prep.detectedJurisdiction ?? ""] ?? "תחום שיפוט אחר"}); האזכור נשמר כפי שהוזן, ללא עיצוב וללא חיפוש.`;
    return { citation, reply: `${citation}\n⚠️ ${warning}`, status: "warning", warningMsg: warning, sourceType: prep.sourceType, sourceLabel: SOURCE_TYPE_LABELS[prep.sourceType] };
  }
  return build(prep, prep.fields, []);
}

const MERGE_RULES: Record<StatuteJurisdiction, Record<string, RegExp>> = {
  US: { titleNumber: /^\d{1,3}$/, code: /^U\.S\.C\.(?:A\.)?$/, year: new RegExp(`^${YEAR}$`) },
  UK: { year: new RegExp(`^${YEAR}$`), chapter: /^[0-9A-Za-z]{1,10}$/ },
};

const W_UNSUPPORTED = "תשובת השרת לחיפוש החוק אינה בפורמט נתמך; נשמרו רק הפרטים שסיפקתם ולא שולב תוכן מהתשובה.";
const W_UNAVAILABLE = "חיפוש פרטי החוק לא היה זמין כעת; נשמרו רק הפרטים שסיפקתם.";
const W_INVALID = "בקשת החיפוש לא התקבלה; נשמרו רק הפרטים שסיפקתם.";
const W_UNMATCHED = "לא נמצא רישום רשמי תואם יחיד לחוק; נשמרו רק הפרטים שסיפקתם ולא שולבו פרטים מהחיפוש.";

/** Terminal rendering of a typed statute response. Never returns null. */
export function renderForeignStatuteLookup(prep: StatutePreparation, response: unknown): StatuteRenderResult {
  const fl = response && typeof response === "object" ? response as ForeignStatuteLookupResponse : null;
  const valid = !!fl && fl.statuteResponseVersion === STATUTE_RESPONSE_VERSION && fl.kind === "statute";
  if (!valid) return build(prep, prep.fields, [W_UNSUPPORTED]);
  if (fl.error !== undefined) {
    return build(prep, prep.fields, [fl.error === "invalid_statute_request" ? W_INVALID : W_UNAVAILABLE]);
  }
  const conflicts = fl.identity?.conflicts;
  const accepted = fl.identity?.matched === true && Array.isArray(conflicts) && conflicts.length === 0 &&
    fl.identity.jurisdiction === prep.jurisdiction && !!fl.fields && typeof fl.fields === "object";
  if (!accepted) return build(prep, prep.fields, [W_UNMATCHED]);
  const merged: Record<string, StatuteFieldValue> = { ...prep.fields };
  for (const [k, rule] of Object.entries(MERGE_RULES[prep.jurisdiction])) {
    const v = (fl.fields as Record<string, unknown>)[k];
    if (merged[k] === undefined && typeof v === "string" && rule.test(v.trim())) merged[k] = v.trim();
  }
  return build(prep, merged, []);
}
