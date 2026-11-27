/** Party-name lookup: one dated decision header from one document, never a model row. */
import { CASE_DOCKET_RE, CASE_TYPE_PREFIXES, findBareDocket } from "./caseTypePrefixes.ts";
import { findTypedPadiEvidence, readTypedDecisionDate, typedSupremeFilingYear, type PadiPublication } from "./padiPublicationEvidence.ts";
import { escapeCitationLiteral } from "./citationPure/segments.ts";

const clean = (s: string) => s.normalize("NFKC").replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[־‐‑‒–—]/g, "-").trim();
const ci = (s: string) => clean(s).replace(/["״'׳.,]/g, "").replace(/\s+/g, " ").trim();
const types = new Map(CASE_TYPE_PREFIXES.map((type) => [ci(type), type.replace(/"/g, "״").replace(/'/g, "׳")]));
const supremeCaseTypes = new Set(["בג״ץ", "דנג״ץ", "דנ״פ", "דנ״א", "דנ״מ", "מ״ח"]);
const docket = "(?:[1-9]\\d{0,5}/(?:\\d{4}|\\d{2})|[1-9]\\d{0,5}-(?:0?[1-9]|1[0-2])-(?:\\d{4}|\\d{2}))";
const shortDocket = "[1-9]\\d{0,5}-\\d{2}";
const procedure = "[א-ת]{1,5}(?:[\"״'׳][א-ת]{0,3})?";
const name = /^[\p{L}\p{M}][\p{L}\p{M} "״'׳.,&-]{0,148}[\p{L}\p{M}]$/u;
const versus = /\s+(?:נגד|נ['׳״".]?)\s+/u;
const court = /^(?:בית המשפט (?:העליון|המחוזי ב[א-ת -]{2,25}|השלום ב[א-ת -]{2,25})|בית הדין (?:הארצי לעבודה|האזורי לעבודה ב[א-ת -]{2,25})|עליון)$/u;
const badParty = new Set(["ישראל", "מדינה", "המדינה", "מבקש", "המשיב", "התובעת", "הנאשם", "פלוני", "פלונית"]);
const isName = (s: string) => s.length <= 150 && name.test(s.replace(/\s+\((?:19|20)\d{2}\)(?=\s+בע["״]מ$)/u, "")) && !/(?:^| )(?:החלטה|פסק דין|בעניין|בענין|ראה גם|ראו גם|ואח׳)(?: |$)/u.test(s);
const datePattern = "(?:\\d{1,2}\\.\\d{1,2}\\.(?:19|20)\\d{2}|(?:19|20)\\d{2}-\\d{2}-\\d{2})";
const decisionKindPattern = "(?:פסק[ -]דין|הכרעת[ -]דין|גזר[ -]דין|החלטה)";
const decisionKinds = new Set(["פסק דין", "הכרעת דין", "גזר דין", "החלטה"]);

export interface IsraeliPartyQuery { caseType?: string; party1: string; party2: string }
export interface IsraeliPartyDecision {
  caseType: string; caseNumber: string; party1: string; party2: string; date: string; sourceUrl: string;
  court?: string; location?: string; decisionKind?: string; publication?: PadiPublication;
}
export interface IsraeliPartyChoice { version: 1; rawInput: string; records: IsraeliPartyDecision[] }

export function parseIsraeliPartyQuery(raw: string): IsraeliPartyQuery | null {
  const lexical = raw.replace(/\s+\((?:19|20)\d{2}\)(?=\s+בע["״]מ(?:\s|$))/gu, "");
  if (raw.length > 320 || /[\r\n\d[\]<>]/u.test(lexical)) return null;
  let input = clean(raw);
  const prefix = new RegExp(`^(${procedure})\\s+(.+)$`, "u").exec(input);
  const caseType = prefix ? types.get(ci(prefix[1])) : undefined;
  if (caseType && prefix) input = prefix[2];
  const parts = input.split(versus).map((p) => p.trim());
  if (parts.length !== 2 || !parts.every((p) => isName(p) && /[א-ת]/u.test(p) && ci(p).length >= 2)) return null;
  return { ...(caseType ? { caseType } : {}), party1: parts[0], party2: parts[1] };
}

/** Scope gate, deliberately broader than the exact query parser. Once this
 * is a classified Israeli name-only case, malformed text may abstain but
 * never slip through to a model-authored decision list. */
export function isIsraeliPartyLookupInput(raw: string): boolean {
  if (raw.length > 700 || CASE_DOCKET_RE.test(raw) || findBareDocket(raw)) return false;
  if (parseIsraeliPartyQuery(raw)) return true;
  const parts = clean(raw).split(versus);
  return parts.length >= 2 && parts.every((p) => /[א-ת]{2}/u.test(p));
}

function partyMatches(proven: string, query: string) {
  const full = ci(proven), want = ci(query);
  const company = full.replace(/^חברת /u, "").replace(/ בעמ$/u, "");
  return full === want || (company !== full && company === want) ||
    (full.endsWith(" בעמ") && !want.includes(" ") && want.length >= 4 && !badParty.has(want) && company.startsWith(`${want} `)) || (!want.includes(" ") && want.length >= 3 && !badParty.has(want) && full.endsWith(` ${want}`));
}
function partiesMatch(record: Pick<IsraeliPartyDecision, "caseType" | "party1" | "party2">, query: IsraeliPartyQuery) {
  if (query.caseType && record.caseType !== query.caseType) return false;
  const same = partyMatches(record.party1, query.party1) && partyMatches(record.party2, query.party2);
  // An untyped name lookup can mean the overall case family (appeal versus
  // prosecution). Always DISPLAY the document order; an explicit type and
  // caption is a narrower request and does not opt in to reversed roles.
  return same || (!query.caseType && partyMatches(record.party1, query.party2) && partyMatches(record.party2, query.party1));
}
function knownDate(value: string) {
  const parsed = readTypedDecisionDate(value);
  const now = new Date();
  if (!parsed || +parsed.year < 1948) return null;
  const [day, month, year] = parsed.date.split(".").map(Number);
  return Date.UTC(year, month - 1, day) <= now.getTime() ? parsed : null;
}
const locationName = /^[א-ת](?:[א-ת '"״׳-]{0,23}[א-ת])?['׳]?$/u;
const canonicalCourt = (text?: string) => text === "עליון" ? "בית המשפט העליון" : text && court.test(text) ? text : undefined;

function sourceRecord(url: unknown): { url: URL; path: string; database: string } | null {
  if (typeof url !== "string" || url.length > 800) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return null;
    const host = u.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(u.pathname);
    if (host === "he.afiklaw.com" && /^\/caselaw\/[1-9]\d{0,7}\/?$/u.test(path)) return { url: u, path, database: "" };
    if (host === "din.co.il" && /^\/images\/\d{8}\.[a-z]\d+\.pdf$/iu.test(path)) return { url: u, path, database: "" };
    if (host === "psikan.com" && /^\/rulings\/[^/]+(?:\/[^/]+)?\/?$/u.test(path)) return { url: u, path, database: "פסיקן" };
    if (host === "nevo.co.il" && /^\/psika_html\/(?:[^/]+\/)+[^/]+\.htm[l]?$/iu.test(path)) return { url: u, path, database: "נבו" };
    if (host === "psakdin.co.il" && /^\/Court\/[^/]+\/?$/u.test(path)) return { url: u, path, database: "פסקדין" };
    if ((host === "supremedecisions.court.gov.il" || host === "supreme.court.gov.il") &&
      ((/^\/Home\/Download\/?$/iu.test(path) && !!u.searchParams.get("path")) || /\.(?:pdf|docx?)$/iu.test(path))) return { url: u, path, database: "אר״ש" };
    if (host === "court.gov.il" && /^\/NGCS.Web.Secured\.UI\/WebPages\/Viewer\/Verdict\.aspx$/iu.test(path) && u.search) return { url: u, path, database: "אר״ש" };
    if (host === "gov.il" && /^\/BlobFolder\/dynamiccollectorresultitem\/decision[^/]+\/he\/[^/]+\.pdf$/iu.test(path) && !/תקציר|summary/u.test(path)) return { url: u, path, database: "" };
    return null;
  } catch { return null; }
}
const header = new RegExp(`^(${procedure})(?:\\s*\\(([א-ת '"״׳-]{1,25})\\))?\\s+(${docket}|${shortDocket})(?![\\d/-])(?:\\s*[:|]\\s*|\\s+)`, "u");
const datedEnd = new RegExp(`(?:\\s*\\(\\s*(${datePattern})\\s*\\)|\\s*[·|]\\s*(?:(${decisionKindPattern})\\s*[,|]?\\s*)?(${datePattern}))\\s*(?:[·|]\\s*(?:פסיקן|נבו|פסקדין))?$`, "u");
// Only initial official caption rows, never later references/body dates.
const roles = /^(?:לפני:\s*(?:(?:כבוד|כב')[^\n]{1,100}\n){1,6})?(?:המערער(?:ת)?|המבקש(?:ת)?|העותר(?:ת)?|התובע(?:ת)?|המאשימה)\s*:\s*([^\n]{2,150})\nנ\s*ג\s*ד\n(?:המשיב(?:ה)?|הנתבע(?:ת)?|הנאשם(?:ת)?)(?: [1-9])?\s*:\s*([^\n]{2,150})(?:\n|$)/u;

function ownSlugMatches(source: NonNullable<ReturnType<typeof sourceRecord>>, type: string, ref: string): boolean {
  if (source.url.hostname.replace(/^www\./, "") === "din.co.il") {
    const encoded = /^\/images\/(\d{2})(\d{5})0\.[a-z]\d+\.pdf$/iu.exec(source.path);
    return !!encoded && ref === `${Number(encoded[2])}/${encoded[1]}`;
  }
  if (source.url.hostname.replace(/^www\./, "") === "gov.il") {
    const identifier = /\/dynamiccollectorresultitem\/decision(\d+(?:-\d+){1,2})\//u.exec(source.path)?.[1];
    return !!identifier && identifier === ref.replace(/\//g, "-");
  }
  if (source.database !== "פסיקן") return true;
  const slug = source.path.split("/")[2] ?? "";
  const re = new RegExp(`(?:^|-)${ci(type)}-${ref.replace(/\//g, "-")}$`, "u");
  return re.test(ci(slug));
}

function fromHeader(value: string, source: NonNullable<ReturnType<typeof sourceRecord>>) {
  const match = header.exec(value);
  if (!match) return null;
  const type = types.get(ci(match[1]));
  if (!type) return null;
  const ref = match[3];
  const remainder = value.slice(match[0].length);
  const end = datedEnd.exec(remainder);
  const parsed = end ? knownDate(end[1] ?? end[3]) : null;
  // A malformed date is not the same as a missing date.
  if (end && !parsed) return null;
  const preliminaryCourt = canonicalCourt(remainder.split("|")[0]?.trim());
  const location = match[2] && locationName.test(match[2]) ? match[2] : undefined;
  const normalizedRef = new RegExp(`^${shortDocket}$`, "u").test(ref) ? ref.replace("-", "/") : ref;
  if (!ownSlugMatches(source, type, normalizedRef)) return null;
  let caption = remainder.slice(0, end?.index ?? remainder.length).trim().replace(/\s*[·|]\s*(?:פסק[ -]דין|הכרעת[ -]דין|גזר[ -]דין|החלטה)$/u, "");
  // Pipe metadata is allowed only as an explicitly recognized court before caption.
  if (preliminaryCourt) caption = caption.replace(/^[^|]+\|\s*/u, "");
  const parts = caption.split(versus).map((p) => p.trim());
  if (parts.length !== 2 || !parts.every(isName)) return null;
  const explicitKind = end?.[2]?.replace("-", " ") ?? /[·|]\s*(פסק[ -]דין|הכרעת[ -]דין|גזר[ -]דין|החלטה)\s*$/u.exec(remainder.slice(0, end?.index ?? remainder.length))?.[1]?.replace("-", " ");
  const supreme = source.url.hostname.endsWith(".court.gov.il") && source.url.hostname.includes("supreme") ||
    supremeCaseTypes.has(type) ||
    (source.database === "נבו" && source.path.startsWith("/psika_html/elyon/"));
  return {
    caseType: type, caseNumber: normalizedRef, party1: parts[0], party2: parts[1], date: parsed?.date ?? "", sourceUrl: source.url.href,
    ...((preliminaryCourt || supreme) ? { court: preliminaryCourt ?? "בית המשפט העליון" } : {}), ...(location ? { location } : {}),
    ...(explicitKind ? { decisionKind: explicitKind } : {}),
  } satisfies IsraeliPartyDecision;
}

/** Some old opinions publish an explicitly dated original header under the
 * repository's title/posted date. Only consume exact own header metadata. */
function afikOriginalHeader(record: IsraeliPartyDecision, headline: string, snippet: string): IsraeliPartyDecision {
  const lines = snippet.split(/\r?\n/u).map((line) => clean(line)).filter(Boolean);
  const h = lines.findIndex((line, i) => i < 8 && /^ערעור אזרחי מס['׳] /u.test(line));
  if (h < 0 || record.caseType !== "ע״א" || lines[h] !== `ערעור אזרחי מס' ${record.caseNumber}` ||
      ci(lines[h + 1] ?? "") !== ci(record.party1) || lines[h + 2] !== "נגד" ||
      ci(lines[h + 3] ?? "") !== ci(record.party2) || !/^בבית המשפט העליון בשבתו כבית-?משפט לערעורים אזרחיים$/u.test(lines[h + 4] ?? "")) return record;
  const filingYear = typedSupremeFilingYear(record.caseNumber.split("/")[1] ?? "");
  const signed = /^\[(\d{1,2}\.\d{1,2}\.)(\d{2}|(?:19|20)\d{2})\]$/u.exec(lines[h + 5] ?? "");
  if (!signed || !filingYear) return { ...record, court: "בית המשפט העליון" };
  const year = signed[2].length === 4 ? +signed[2] : Math.floor(filingYear / 100) * 100 + +signed[2];
  if (year < filingYear || (signed[2].length === 2 && year < 1948)) return record;
  const date = knownDate(signed[1] + year);
  if (!date) return record;
  // This excerpt proves BOTH exact own-caption parties and its original date,
  // then the separate headline reporter is from that very same case record.
  const pub = /,\s*פ["״]ד\s+([א-ת]{1,4})(?:\(([1-9])\))?\s+([1-9]\d{0,3})$/u.exec(headline);
  return { ...record, court: "בית המשפט העליון", date: date.date,
    ...(pub ? { publication: { padi_volume: pub[1], padi_part: pub[2] ?? "", padi_page: pub[3], year: date.year } } : {}) };
}

type SearchRow = { title?: unknown; snippet?: unknown; url?: unknown };
function fromOwnHeader(row: SearchRow): IsraeliPartyDecision | null {
  const source = sourceRecord(row.url);
  if (!source || typeof row.title !== "string" || row.title.length > 650) return null;
  const isAfik = source.url.hostname === "he.afiklaw.com";
  const title = clean(row.title).replace(isAfik ? /\s*·\s*פסקי דין\s*·\s*אפיק ושות[׳']$/u : /$^/u, "");
  // Afik's website-level date is not necessarily the decision date. Its own
  // case title can still prove docket and parties; don't use the site timestamp.
  const afikOwnCaption = isAfik ? title.replace(/,\s*פ["״]ד\s+[א-ת]{1,4}(?:\(\d\))?\s+\d{1,4}$/u, "") : title;
  // Never source a dated decision from a citation found only in body prose.
  const fromTitle = fromHeader(afikOwnCaption, source);
  if (fromTitle?.date) return fromTitle;
  if (typeof row.snippet !== "string" || row.snippet.length > 12000) return fromTitle;
  const snippet = clean(row.snippet);
  if (isAfik && fromTitle) return afikOriginalHeader(fromTitle, title, snippet);
  // A provider can return the publisher's complete citation as its first line.
  // It must agree with the result's own document title, not a cited docket in body.
  const firstLine = snippet.split(/\r?\n/u, 1)[0];
  const first = firstLine.replace(/\s*·\s*https:\/\/[^\s]+$/u, "");
  const typed = header.exec(title);
  const parsed = fromHeader(first, source);
  if (typed && parsed && types.get(ci(typed[1])) === parsed.caseType &&
      typed[3].replace(/^([1-9]\d{0,5})-(\d{2})$/, "$1/$2") === parsed.caseNumber &&
      ci(first.slice(0, title.length)) === ci(title)) return parsed;

  // Own original text: role labels and explicitly signed decision date before
  // any body/headline for another proceeding. A hearing date is not a decision date.
  if (!/^פסק[ -]דין בתיק |^החלטה בתיק /u.test(title) || !/^(?:בית המשפט|בבית המשפט)/u.test(snippet)) return fromTitle;
  const titleDocket = new RegExp(`^(?:פסק[ -]דין|החלטה) בתיק\\s+(${procedure})\\s+(${docket})$`, "u").exec(title);
  if (!titleDocket) return null;
  const type = types.get(ci(titleDocket[1]));
  if (!type || !ownSlugMatches(source, type, titleDocket[2])) return null;
  const lines = snippet.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const courtName = canonicalCourt(lines[0].replace(/^ב(?=בית)/u, "").replace(/ בשבתו.+$/u, ""));
  if (!courtName || ci(lines[1] ?? "") !== ci(`${type} ${titleDocket[2]}`)) return null;
  // Some official files place a role on its own line before the name.
  const captionRows = lines.slice(2, 22).join("\n").replace(/(:)\n(?=[\p{L}])/gu, "$1 ");
  const caption = roles.exec(captionRows);
  if (!caption) return null;
  const explicit = new RegExp(`^(?:פסק[ -]דין|החלטה)\\s*\\n(?:ניתן|ניתנה) ביום\\s+(${datePattern})\\s*(?:\\n|$)`, "u").exec(captionRows.slice(caption[0].length));
  const date = explicit && knownDate(explicit[1]);
  if ((explicit && !date) || !isName(caption[1].trim()) || !isName(caption[2].trim())) return null;
  return { caseType: type, caseNumber: titleDocket[2], court: courtName, party1: caption[1].trim(), party2: caption[2].trim(), date: date?.date ?? "",
    sourceUrl: source.url.href, decisionKind: /^החלטה/u.test(title) ? "החלטה" : "פסק דין" };
}

const caseKey = (r: IsraeliPartyDecision) => [r.caseType, r.caseNumber, r.date, r.court ?? r.location ?? "", ci(r.party1), ci(r.party2), r.decisionKind ?? ""].join("|");
export const israeliPartyOptionId = (r: IsraeliPartyDecision) => caseKey(r);
const dateSort = (x: string) => { if (!x) return 0; const [d, m, y] = x.split(".").map(Number); return y * 10000 + m * 100 + d; };
const sourceRank = (u: string) => ({ "אר״ש": 3, "נבו": 2, "פסקדין": 1, "פסיקן": 1 }[sourceRecord(u)?.database ?? ""] ?? 0);

export function groundIsraeliPartyDecisions(query: IsraeliPartyQuery, payloads: readonly unknown[]): IsraeliPartyDecision[] {
  const byRecord = new Map<string, IsraeliPartyDecision>();
  const blockedPrint = new Set<string>();
  const invalidUrls = new Set<string>();
  const byUrl = new Map<string, string>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || !("search_results" in payload) || !Array.isArray(payload.search_results)) continue;
    for (const row of payload.search_results.slice(0, 30)) {
      if (!row || typeof row !== "object") continue;
      const r = fromOwnHeader(row);
      if (!r || !partiesMatch(r, query)) continue;
      const originalYear = r.caseNumber.includes("/") ? typedSupremeFilingYear(r.caseNumber.split("/")[1]) : null;
      if (r.date && originalYear && dateSort(r.date) < originalYear * 10000) continue;
      // Printed evidence must be for this exact decision/day, not just the
      // same docket and calendar year. Unproved print never changes Rule 19.
      if (r.date && r.court === "בית המשפט העליון" && originalYear) {
        const padi = findTypedPadiEvidence({ ...r, filingYear: originalYear }, { search_results: [row] });
        if (padi.kind === "verified" && padi.date === r.date) r.publication = padi.publication;
      }
      const key = caseKey(r);
      const oldKey = byUrl.get(r.sourceUrl);
      if (oldKey && oldKey !== key) invalidUrls.add(r.sourceUrl);
      else byUrl.set(r.sourceUrl, key);
      const old = byRecord.get(key);
      if (old?.publication && r.publication && JSON.stringify(old.publication) !== JSON.stringify(r.publication)) blockedPrint.add(key);
      if (!old || (!old.publication && r.publication) ||
        (!!old.publication === !!r.publication && sourceRank(r.sourceUrl) > sourceRank(old.sourceUrl))) byRecord.set(key, r);
    }
  }
  const valid = [...byRecord.entries()].filter(([, r]) => !invalidUrls.has(r.sourceUrl)).map(([key, r]) => {
    if (!blockedPrint.has(key)) return r;
    // Leave the same dated decision usable, but a disputed printed tuple
    // cannot become the citation for any mirror of that decision.
    const { publication: _disputed, ...rest } = r;
    return rest;
  });
  // An undated mirror cannot stand in as a separate decision if a dated
  // decision of that same proceeding is already known. Never transfer dates.
  const results = valid.filter((r) => r.date || !valid.some((d) => d.date && d.caseType === r.caseType &&
    d.caseNumber === r.caseNumber && (!r.decisionKind || !d.decisionKind || r.decisionKind === d.decisionKind) &&
    ci(r.party1) === ci(d.party1) && ci(r.party2) === ci(d.party2)));
  return results.sort((a, b) => dateSort(b.date) - dateSort(a.date) || caseKey(a).localeCompare(caseKey(b), "he")).slice(0, 5);
}

function validRecord(x: unknown, query: IsraeliPartyQuery): x is IsraeliPartyDecision {
  if (!x || typeof x !== "object") return false;
  const r = x as IsraeliPartyDecision;
  if (![r.caseType,r.caseNumber,r.party1,r.party2,r.date,r.sourceUrl].every((v) => typeof v === "string") ||
    !sourceRecord(r.sourceUrl) || !ownSlugMatches(sourceRecord(r.sourceUrl)!, r.caseType, r.caseNumber) ||
    !new RegExp(`^${docket}$`, "u").test(r.caseNumber) || types.get(ci(r.caseType)) !== r.caseType ||
    !isName(r.party1) || !isName(r.party2) || (r.date !== "" && knownDate(r.date)?.date !== r.date) || !partiesMatch(r, query) ||
    (r.court !== undefined && (typeof r.court !== "string" || !court.test(r.court))) ||
    (r.location !== undefined && (typeof r.location !== "string" || !locationName.test(r.location))) ||
    (r.decisionKind !== undefined && !decisionKinds.has(r.decisionKind))) return false;
  if (r.publication !== undefined) {
    const p = r.publication;
    if (!p || r.court !== "בית המשפט העליון" || (r.date.split(".")[2] !== p.year) ||
        !/^[א-ת]{1,4}$/u.test(p.padi_volume) || !/^[1-9]?$/u.test(p.padi_part) || !/^[1-9]\d{0,3}$/u.test(p.padi_page)) return false;
  }
  return true;
}

export function readIsraeliPartyChoice(value: unknown, rawInput: string): IsraeliPartyChoice | null {
  const query = parseIsraeliPartyQuery(rawInput);
  const choice = value as IsraeliPartyChoice | null;
  if (!query || choice?.version !== 1 || choice.rawInput !== rawInput || !Array.isArray(choice.records) ||
    choice.records.length < 1 || choice.records.length > 5 || !choice.records.every((r) => validRecord(r, query)) ||
    new Set(choice.records.map(caseKey)).size !== choice.records.length ||
    new Set(choice.records.map((r) => r.sourceUrl)).size !== choice.records.length) return null;
  return choice;
}

const partyDisplay = (p: string, user?: string) => user && !ci(user).includes(" ") && partyMatches(p, user) && ci(p) !== ci(user) ? user : p;
export function israeliPartyDecisionLabel(r: IsraeliPartyDecision): string {
  return `${r.caseType} ${r.location ? `(${r.location}) ` : ""}${r.caseNumber} ${r.party1} נ׳ ${r.party2} (${r.date || "תאריך לא אומת"})${r.decisionKind ? ` · ${r.decisionKind}` : ""}${r.court ? ` · ${r.court}` : ""}`;
}

export function renderIsraeliPartyDecision(r: IsraeliPartyDecision, rawInput: string) {
  const query = parseIsraeliPartyQuery(rawInput);
  const database = sourceRecord(r.sourceUrl)?.database;
  const venue = /(המחוזי|השלום|האזורי לעבודה) ב(.+)$/u.exec(r.court ?? "");
  const courtType = venue?.[1].replace(/^ה/u, "") ?? (r.location && r.caseType === "תפ״ח" ? "מחוזי" : undefined);
  const courtPlace = r.location ?? venue?.[2];
  const place = courtPlace === "נצרת" ? "נצ׳" : courtPlace?.replace(/'$/u, "׳");
  const caseCourt = courtType && place ? ` (${courtType} ${place})`
    : r.court === "בית הדין הארצי לעבודה" ? " (ארצי)" : "";
  const reversed = query && !query.caseType && !partyMatches(r.party1, query.party1);
  const p1 = escapeCitationLiteral(partyDisplay(r.party1, reversed ? query?.party2 : query?.party1));
  const p2 = escapeCitationLiteral(partyDisplay(r.party2, reversed ? query?.party1 : query?.party2));
  const prefix = `${r.caseType}${caseCourt} ${r.caseNumber} **${p1}** נ׳ **${p2}**`;
  const publication = r.publication;
  const citation = publication
    ? `${prefix}, פ״ד ${publication.padi_volume}${publication.padi_part ? `(${publication.padi_part})` : ""} ${publication.padi_page} (${publication.year}).`
    : `${prefix} (${database ? `${database} ` : ""}${r.date || "[חסר: תאריך]"}).`;
  const warnings: string[] = [];
  if (!r.date) warnings.push("תאריך ההחלטה לא אומת.");
  if (!publication && !database) warnings.push("לא אומת מאגר פרסום.");
  if (!caseCourt && r.court !== "בית המשפט העליון") warnings.push("לא אומתה הערכאה או מקום מושבה.");
  const warningMsg = warnings.length ? warnings.join(" ") : undefined;
  return { citation, reply: citation + (warningMsg ? `\n⚠️ ${warningMsg}` : ""), warningMsg,
    status: warningMsg ? "warning" as const : "valid" as const,
    sourceType: publication ? "case_law_published" as const : "case_law_database" as const };
}

export function selectIsraeliPartyDecision(choice: unknown, id: string, rawInput: string) {
  const record = readIsraeliPartyChoice(choice, rawInput)?.records.find((r) => caseKey(r) === id);
  return record ? renderIsraeliPartyDecision(record, rawInput) : null;
}

export const partyNoMatch = (raw: string) => `${escapeCitationLiteral(raw)}\n⚠️ לא נמצאה החלטה שאפשר לאמת לפי שמות הצדדים. נסו להוסיף מספר תיק מדויק.`;
export const partyChoicePrompt = "נמצאו כמה החלטות מאומתות. בחרו לפי מספר התיק והתאריך.";
export const partyChoiceUnavailable = "נמצאו כמה החלטות מאומתות. יש לבחור באזכור מהיר, או להוסיף לתיאור מספר תיק ותאריך.";
