/**
 * Bounded AU/CA online completion — pure contract shared by browser and Deno.
 *
 * Scope is exactly the six enabled AU/CA local templates. This module decides
 * (1) whether an incomplete AU/CA citation may ask for missing facts, (2) how
 * full citation forms found in search evidence become complete per-template
 * records grouped by decision, and (3) how a returned record is accepted: the
 * merged fields are re-read by the same local template parser, so only a
 * complete, template-exact citation can be rendered. No IO, no model text.
 */
import { auEvidence, caEvidence, parseCountryLocal, renderCountryLocal, type CountryAst } from "./countryLocal.ts";

export type CountryJurisdiction = "AU" | "CA";
export type CountryFamily = "case" | "statute";
export type CountryTemplateId =
  | "au.case.neutral" | "au.case.reported" | "au.statute.cth"
  | "ca.case.scc_neutral" | "ca.case.scr" | "ca.statute.federal";

/** Wire field keys for AU/CA lookups (must stay inside the recovery field list). */
export const COUNTRY_FIELD_KEYS: Record<CountryFamily, readonly string[]> = {
  case: ["caseName", "neutralYear", "court", "neutralNumber", "decisionDate", "reporterYear", "reporterVolume", "reporter", "firstPage", "year", "decisionYear"],
  statute: ["statuteName", "enactmentYear", "revisionYear", "code", "chapter"],
};
const TEMPLATE_KEYS: Record<CountryTemplateId, readonly string[]> = {
  "au.case.neutral": ["neutralYear", "court", "neutralNumber", "decisionDate"],
  "au.case.reported": ["reporterYear", "reporterVolume", "reporter", "firstPage"],
  "ca.case.scc_neutral": ["neutralYear", "neutralNumber", "reporterYear", "reporterVolume", "reporter", "firstPage"],
  "ca.case.scr": ["reporterYear", "reporterVolume", "reporter", "firstPage"],
  "au.statute.cth": ["enactmentYear", "code"],
  "ca.statute.federal": ["code", "revisionYear", "enactmentYear", "chapter"],
};
const TEMPLATES_FOR: Record<string, readonly CountryTemplateId[]> = {
  "AU:case": ["au.case.neutral", "au.case.reported"],
  "CA:case": ["ca.case.scc_neutral", "ca.case.scr"],
  "AU:statute": ["au.statute.cth"],
  "CA:statute": ["ca.statute.federal"],
};
const BASES = new Set(["official_record", "structured_metadata", "publisher_metadata", "repository_metadata", "search_result_explicit", "document_inspection"]);
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * Reporter forms that share AU/CA letters but belong elsewhere. "(2010) 5 SCC 1"
 * is the Indian Supreme Court Cases reporter, not a Canadian neutral citation.
 */
const OTHER_COUNTRY_FORMS = /\(\d{4}\)\s+\d+\s+SCC\b|\bSCC\s+OnLine\b|\bAIR\s+\d{4}\s+SC\b|\b\d{4}\s+INSC\s+\d+/;

/**
 * Country evidence from the full citation shape, never one abbreviation.
 * "ambiguous": the form is used by another country, or AU and CA forms are mixed.
 */
export function countryCues(raw: string): CountryJurisdiction | "ambiguous" | "none" {
  const au = auEvidence(raw), ca = caEvidence(raw);
  if (OTHER_COUNTRY_FORMS.test(raw) || (au && ca)) return "ambiguous";
  return au ? "AU" : ca ? "CA" : "none";
}

export interface CountryLookupRequest {
  enabled: true;
  kind: CountryFamily;
  jurisdiction: CountryJurisdiction;
  rawInput: string;
  parsedFields: Record<string, string>;
}
export type CountryLookupDecision =
  | { kind: "lookup"; request: CountryLookupRequest }
  | { kind: "blocked"; reason: "country_form_conflict" };

const twoParties = (name: string) => {
  const m = name.match(/^(.+?)\s+(?:v\.?|c\.)\s+(.+)$/u);
  return !!m && /[A-Za-z]{2}/.test(m[1]) && /[A-Za-z]{2}/.test(m[2]);
};
const stripSuffix = (s: string) => s.trim().replace(/\.$/, "").replace(/\s*\((?:Austl|Can)\.\)\s*\.?$/, "").trim();

/** Supplied case fields of an incomplete AU/CA citation; null when any part is not understood. */
function caseSupplied(raw: string, jurisdiction: CountryJurisdiction): Record<string, string> | null {
  const s = stripSuffix(raw);
  const tailAt = s.search(jurisdiction === "AU" ? /\s*,?\s*(?:\[\d{4}\]|\(\d{4}\))/ : /\s*,?\s*(?:\[\d{4}\]|\(\d{4}\)|\b\d{4}\s+SCC\b)/);
  const caseName = (tailAt >= 0 ? s.slice(0, tailAt) : s).trim().replace(/[,\s]+$/, "");
  const tail = (tailAt >= 0 ? s.slice(tailAt) : "").trim().replace(/^,\s*/, "");
  if (!caseName || !twoParties(caseName)) return null;
  const out: Record<string, string> = { caseName };
  const put = (k: string, v: string | undefined) => { if (v) out[k] = v; };
  if (!tail) return out;
  if (jurisdiction === "AU") {
    let m = tail.match(new RegExp(String.raw`^\[(\d{4})\]\s+(HCA|FCA)(?:\s+(\d+))?(?:\s*\((\d{1,2}\s+(?:${MONTHS})\s+\d{4})\))?$`));
    if (m) { put("neutralYear", m[1]); put("court", m[2]); put("neutralNumber", m[3]); put("decisionDate", m[4]); return out; }
    m = tail.match(/^\((\d{4})\)(?:\s+(\d+))?(?:\s+(CLR|FCR))?(?:\s+(\d+))?$/);
    if (m && !m[2] && !m[3] && !m[4]) { put("year", m[1]); return out; }
    if (m && m[3]) { put("reporterYear", m[1]); put("reporterVolume", m[2]); put("reporter", m[3]); put("firstPage", m[4]); return out; }
    return null;
  }
  let m = tail.match(/^(\d{4})\s+SCC(?:\s+(\d+))?(?:,\s*\[(\d{4})\]\s+(\d+)\s+(S\.C\.R\.|SCR)(?:\s+(\d+))?)?$/);
  if (m) { put("neutralYear", m[1]); put("neutralNumber", m[2]); put("reporterYear", m[3]); put("reporterVolume", m[4]); put("reporter", m[5]); put("firstPage", m[6]); return out; }
  m = tail.match(/^(?:\((\d{4})\)\s*,?\s*)?\[(\d{4})\](?:\s+(\d+))?(?:\s+(S\.C\.R\.|SCR))?(?:\s+(\d+))?$/);
  if (m) {
    if (Number(m[2]) < 1975) return null;
    put("decisionYear", m[1]); put("reporterYear", m[2]); put("reporterVolume", m[3]); put("reporter", m[4]); put("firstPage", m[5]);
    return out;
  }
  m = tail.match(/^\((\d{4})\)$/);
  if (m) { put("decisionYear", m[1]); return out; }
  return null;
}

function statuteSupplied(raw: string, jurisdiction: CountryJurisdiction): Record<string, string> | null {
  const s = stripSuffix(raw);
  if (jurisdiction === "AU") {
    const m = s.match(/^(.+?\bAct)(?:\s+(\d{4}))?(?:\s*\((Cth)\))?$/);
    if (!m || !/[A-Za-z]{3}/.test(m[1].replace(/\bAct$/, ""))) return null;
    return { statuteName: m[1].trim(), ...(m[2] ? { enactmentYear: m[2] } : {}), ...(m[3] ? { code: m[3] } : {}) };
  }
  const m = s.match(/^([^,()]*[A-Za-z][^,()]*?)(?:,\s*(R\.?S\.?C\.?|S\.C\.)(?:,?\s+(\d{4}))?(?:,\s*c\.?\s+([A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*))?)?$/);
  if (!m || m[1].trim().length < 4) return null;
  const out: Record<string, string> = { statuteName: m[1].trim() };
  if (m[2]) out.code = m[2];
  if (m[3]) out[m[2] && /^S/.test(m[2]) ? "enactmentYear" : "revisionYear"] = m[3];
  if (m[3] && !m[2]) return null;
  if (m[4]) out.chapter = m[4];
  return out;
}

/**
 * Whether a recognized but incomplete AU/CA citation may ask for its missing
 * facts. Null keeps the existing local result (complete, conflicting, out of
 * scope or partly unreadable input never searches).
 */
export function planCountryLookup(ast: CountryAst | null, raw: string): CountryLookupDecision | null {
  if (!ast || ast.complete) return null;
  if (countryCues(raw) === "ambiguous") return { kind: "blocked", reason: "country_form_conflict" };
  const cue = countryCues(raw);
  if (ast.conflicts.length || (cue !== "none" && cue !== ast.jurisdiction)) return null;
  const supplied = ast.family === "case" ? caseSupplied(raw, ast.jurisdiction) : statuteSupplied(raw, ast.jurisdiction);
  if (!supplied) return null;
  return { kind: "lookup", request: { enabled: true, kind: ast.family, jurisdiction: ast.jurisdiction, rawInput: raw, parsedFields: supplied } };
}

/** The same plan, derived from raw text and an explicit country only (server re-derivation). */
export function countryPlanFromRaw(raw: string, jurisdiction: CountryJurisdiction, kind: CountryFamily): CountryLookupDecision | null {
  const ast = parseCountryLocal(raw, { jurisdiction, sourceType: kind === "case" ? "foreign_case_other" : "foreign" });
  if (!ast || ast.jurisdiction !== jurisdiction || ast.family !== kind) return null;
  return planCountryLookup(ast, raw);
}

// ── Evidence → complete per-template records ───────────────────────────────

export interface CountryFieldSource { url: string; title?: string; basis: string }
export interface CountryOption {
  id: string;
  templateId: CountryTemplateId;
  label: string;
  fields: Record<string, string>;
  /** Donor source of each field (one complete record per option, never mixed). */
  sources: Record<string, CountryFieldSource>;
}
export interface CountryDecision { id: string; label: string; options: CountryOption[] }

interface Token { type: "neutral" | "report" | "date" | "canlii"; start: number; end: number; v: string[] }
interface Chain { start: number; end: number; tokens: Token[] }

const TOKEN_RES: Record<CountryJurisdiction, Array<[Token["type"], RegExp]>> = {
  AU: [
    ["neutral", /\[(\d{4})\]\s+(HCA|FCA|FCAFC)\s+(\d+)/g],
    ["report", /\((\d{4})\)\s+(\d+)\s+(CLR|FCR)\s+(\d+)/g],
    ["date", new RegExp(String.raw`\((\d{1,2})\s+(${MONTHS})\s+(\d{4})\)`, "g")],
  ],
  CA: [
    ["neutral", /(?<![\d)]\s{0,3})\b(\d{4})\s+SCC\s+(\d+)\b/g],
    ["report", /\[(\d{4})\]\s+(\d+)\s+(S\.\s?C\.\s?R\.|SCR)\s+(\d+)/g],
    ["canlii", /\b(\d{4})\s+CanLII\s+(\d+)(?:\s*\((?:SCC|CSC)\))?/g],
  ],
};

/** Citation chains: tokens separated only by spaces, commas or semicolons. */
export function extractCountryChains(text: string, jurisdiction: CountryJurisdiction): Chain[] {
  const tokens: Token[] = [];
  for (const [type, re] of TOKEN_RES[jurisdiction]) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      tokens.push({ type, start: m.index!, end: m.index! + m[0].length, v: m.slice(1).map((x) => x ?? "") });
    }
  }
  tokens.sort((a, b) => a.start - b.start);
  const chains: Chain[] = [];
  for (const t of tokens) {
    const last = chains[chains.length - 1];
    if (last && t.start >= last.end && /^[\s;,]*$/.test(text.slice(last.end, t.start))) { last.tokens.push(t); last.end = t.end; }
    else if (!last || t.start >= last.end) chains.push({ start: t.start, end: t.end, tokens: [t] });
  }
  return chains.filter((c) => c.tokens.some((t) => t.type === "neutral" || t.type === "report"));
}

const CAPTION_V = /\s(?:v\.?|vs\.?|c\.)\s/g;
/** Same binding rule as US/UK: a chain belongs to the nearest preceding caption naming both parties. */
export function bindCountryChains(text: string, chains: Chain[], hasParty: (t: string, which: 0 | 1) => boolean, noCaptionBound: boolean): boolean[] {
  const out: boolean[] = [];
  let prevEnd = 0, prevBound = noCaptionBound;
  for (const chain of chains) {
    const segment = text.slice(prevEnd, chain.start);
    const vs = [...segment.matchAll(CAPTION_V)];
    const last = vs[vs.length - 1];
    const bound = !last ? prevBound : hasParty(segment.slice(0, last.index!), 0) && hasParty(segment.slice(last.index!), 1);
    out.push(bound); prevBound = bound; prevEnd = chain.end;
  }
  return out;
}

const scr = (s: string) => /^S/.test(s) ? "S.C.R." : s;
const BASIS_RANK: Record<string, number> = { official_record: 0, document_inspection: 1, structured_metadata: 2 };

export interface CountryChainEvidence { chain: Chain; source: CountryFieldSource }

interface RawOption { templateId: CountryTemplateId; key: string; fields: Record<string, string>; source: CountryFieldSource; conflict?: boolean }

/** Options and decision keys of one bound chain. */
function chainOptions(c: Chain, jurisdiction: CountryJurisdiction, source: CountryFieldSource): { keys: string[]; options: RawOption[] } {
  const neutrals = c.tokens.filter((t) => t.type === "neutral");
  const reports = c.tokens.filter((t) => t.type === "report");
  const dates = c.tokens.filter((t) => t.type === "date");
  const keys: string[] = [];
  const options: RawOption[] = [];
  // Two different neutral citations in one chain cannot be one decision.
  if (neutrals.length > 1) return { keys, options };
  const n = neutrals[0];
  if (jurisdiction === "AU") {
    if (n) {
      keys.push(`N|${n.v[1]}|${n.v[0]}|${n.v[2]}`);
      const sameYear = dates.filter((d) => d.v[2] === n.v[0]);
      if (n.v[1] !== "FCAFC" && sameYear.length === 1) {
        const d = sameYear[0];
        options.push({ templateId: "au.case.neutral", key: keys[0], source,
          fields: { neutralYear: n.v[0], court: n.v[1], neutralNumber: n.v[2], decisionDate: `${Number(d.v[0])} ${d.v[1]} ${d.v[2]}` } });
      }
    }
    for (const r of reports) {
      const key = `R|${r.v[2]}|${r.v[1]}|${r.v[3]}`;
      keys.push(key);
      options.push({ templateId: "au.case.reported", key, source, fields: { reporterYear: r.v[0], reporterVolume: r.v[1], reporter: r.v[2], firstPage: r.v[3] } });
    }
    return { keys, options };
  }
  const modern = reports.filter((r) => Number(r.v[0]) >= 1975);
  for (const r of modern) keys.push(`R|SCR|${r.v[0]}|${r.v[1]}|${r.v[3]}`);
  if (n) {
    keys.push(`N|SCC|${n.v[0]}|${n.v[1]}`);
    const parallel = modern.length === 1 ? modern[0] : null;
    options.push({ templateId: "ca.case.scc_neutral", key: `N|SCC|${n.v[0]}|${n.v[1]}`, source,
      fields: { neutralYear: n.v[0], neutralNumber: n.v[1], ...(parallel ? { reporterYear: parallel.v[0], reporterVolume: parallel.v[1], reporter: scr(parallel.v[2]), firstPage: parallel.v[3] } : {}) } });
  } else {
    for (const r of modern) options.push({ templateId: "ca.case.scr", key: `R|SCR|${r.v[0]}|${r.v[1]}|${r.v[3]}`, source,
      fields: { reporterYear: r.v[0], reporterVolume: r.v[1], reporter: scr(r.v[2]), firstPage: r.v[3] } });
  }
  return { keys, options };
}

export function countryOptionLabel(templateId: CountryTemplateId, f: Record<string, string>): string {
  switch (templateId) {
    case "au.case.neutral": return `[${f.neutralYear}] ${f.court} ${f.neutralNumber} (${f.decisionDate})`;
    case "au.case.reported": return `(${f.reporterYear}) ${f.reporterVolume} ${f.reporter} ${f.firstPage}`;
    case "ca.case.scc_neutral": return `${f.neutralYear} SCC ${f.neutralNumber}${f.reporterYear ? `, [${f.reporterYear}] ${f.reporterVolume} S.C.R. ${f.firstPage}` : ""}`;
    case "ca.case.scr": return `[${f.reporterYear}] ${f.reporterVolume} S.C.R. ${f.firstPage}`;
    case "au.statute.cth": return `${f.enactmentYear} (Cth)`;
    case "ca.statute.federal": return `${f.code} ${f.revisionYear ?? f.enactmentYear}, c ${f.chapter}`;
  }
}

/**
 * Group bound chains into decisions (chains sharing a neutral or report key are
 * one decision). One option per complete template record; the same record with
 * contradicting details is dropped instead of guessed.
 */
export function groupCountryDecisions(evidence: CountryChainEvidence[], jurisdiction: CountryJurisdiction): { decisions: CountryDecision[]; conflicts: string[] } {
  const parts = evidence.map((e) => ({ ...chainOptions(e.chain, jurisdiction, e.source), title: e.source.title }));
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (parts[i].keys.some((k) => parts[j].keys.includes(k))) parent[find(j)] = find(i);
  }
  const groups = new Map<number, typeof parts>();
  parts.forEach((p, i) => { if (p.keys.length) groups.set(find(i), [...(groups.get(find(i)) ?? []), p]); });
  const conflicts: string[] = [];
  const decisions: CountryDecision[] = [];
  for (const group of groups.values()) {
    const byKey = new Map<string, RawOption[]>();
    for (const o of group.flatMap((p) => p.options)) byKey.set(`${o.templateId}|${o.key}`, [...(byKey.get(`${o.templateId}|${o.key}`) ?? []), o]);
    const options: CountryOption[] = [];
    for (const [id, list] of byKey) {
      const tmpl = list[0].templateId;
      const fields: Record<string, string> = {};
      const sources: Record<string, CountryFieldSource> = {};
      let broken = false;
      for (const k of TEMPLATE_KEYS[tmpl]) {
        const values = [...new Set(list.map((o) => o.fields[k]).filter((v): v is string => !!v))];
        if (values.length > 1) {
          // A CA parallel report seen differently in two sources is left out; a neutral record with two dates is dropped.
          if (tmpl === "ca.case.scc_neutral" && ["reporterYear", "reporterVolume", "reporter", "firstPage"].includes(k)) { conflicts.push(`location:${id}`); continue; }
          broken = true; conflicts.push(`${k}:${id}`); break;
        }
        if (values.length === 1) {
          fields[k] = values[0];
          const donor = list.filter((o) => o.fields[k] === values[0]).sort((a, b) => (BASIS_RANK[a.source.basis] ?? 9) - (BASIS_RANK[b.source.basis] ?? 9))[0];
          sources[k] = donor.source;
        }
      }
      if (broken) continue;
      if (tmpl === "ca.case.scc_neutral" && conflicts.includes(`location:${id}`)) {
        for (const k of ["reporterYear", "reporterVolume", "reporter", "firstPage"]) { delete fields[k]; delete sources[k]; }
      }
      options.push({ id, templateId: tmpl, label: countryOptionLabel(tmpl, fields), fields, sources });
    }
    // A CA report that is already the parallel of the neutral record is not a separate choice.
    const parallelKeys = new Set(options.filter((o) => o.templateId === "ca.case.scc_neutral" && o.fields.reporterYear)
      .map((o) => `ca.case.scr|R|SCR|${o.fields.reporterYear}|${o.fields.reporterVolume}|${o.fields.firstPage}`));
    const kept = options.filter((o) => !parallelKeys.has(o.id)).sort((a, b) => a.id.localeCompare(b.id));
    if (!kept.length) continue;
    const keyId = [...new Set(group.flatMap((p) => p.keys))].sort().join("+");
    const title = group.map((p) => p.title).find((t) => !!t && t.trim().length >= 6);
    decisions.push({ id: `${jurisdiction}|${keyId}`, label: (title ?? kept.map((o) => o.label).join(" / ")).replace(/\s+/g, " ").trim().slice(0, 160), options: kept });
  }
  return { decisions: decisions.sort((a, b) => a.id.localeCompare(b.id)), conflicts };
}

/** Keep only records that agree with every supplied detail; options outside the supplied form are left out. */
export function filterCountryDecisions(decisions: CountryDecision[], supplied: Record<string, string>): CountryDecision[] {
  const neutralSupplied = ["neutralYear", "court", "neutralNumber", "decisionDate"].some((k) => supplied[k]);
  const reportSupplied = ["reporterYear", "reporterVolume", "reporter", "firstPage"].some((k) => supplied[k]);
  const same = (a: string, b: string) => a.replace(/[.\s]/g, "").toLowerCase() === b.replace(/[.\s]/g, "").toLowerCase();
  const fits = (o: CountryOption) => {
    const f = o.fields;
    if (neutralSupplied && !(o.templateId === "au.case.neutral" || o.templateId === "ca.case.scc_neutral")) return false;
    if (reportSupplied && !f.reporterYear) return false;
    for (const k of ["neutralYear", "court", "neutralNumber", "decisionDate", "reporterYear", "reporterVolume", "reporter", "firstPage"]) {
      if (supplied[k] && (!f[k] || !same(f[k], supplied[k]))) return false;
    }
    const years = [f.neutralYear, f.reporterYear, f.decisionDate?.slice(-4)].filter(Boolean);
    if (supplied.year && !years.includes(supplied.year)) return false;
    if (supplied.decisionYear) {
      const dy = Number(supplied.decisionYear);
      if (f.neutralYear ? Number(f.neutralYear) !== dy : !(Number(f.reporterYear) >= dy && Number(f.reporterYear) <= dy + 1)) return false;
    }
    return true;
  };
  return decisions.map((d) => ({ ...d, options: d.options.filter(fits) })).filter((d) => d.options.length > 0);
}

// ── Statute records from official legislation registers ────────────────────

export interface CountryStatuteRecord { templateId: CountryTemplateId; fields: Record<string, string>; source: CountryFieldSource }
const normName = (s: string) => s.toLowerCase().replace(/[.,'’]/g, "").replace(/\s+/g, " ").trim();
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Commonwealth Act record: legislation.gov.au Act series page whose own title carries name + year. */
export function auStatuteRecord(s: { url: string; title?: string; snippet?: string }, statuteName: string): CountryStatuteRecord | null {
  const host = hostOf(s.url);
  if (!(host === "legislation.gov.au" || host.endsWith(".legislation.gov.au"))) return null;
  if (!/\/C\d{4}A\d{5}(?:\/|$)/.test(new URL(s.url).pathname)) return null;
  const m = (s.title ?? "").match(/^\s*(.+?\bAct)\s+(\d{4})\b/);
  if (!m || normName(m[1]) !== normName(statuteName)) return null;
  return { templateId: "au.statute.cth", fields: { enactmentYear: m[2], code: "Cth" }, source: { url: s.url, ...(s.title ? { title: s.title } : {}), basis: "official_record" } };
}

/** A federal Act record on Justice Laws: "Name (R.S.C., 1985, c. C-46)"; an R.S.C. chapter must match the page code. */
export function caStatuteRecord(s: { url: string; title?: string; snippet?: string }, statuteName: string): CountryStatuteRecord | null {
  const host = hostOf(s.url);
  if (!(host === "laws-lois.justice.gc.ca" || host.endsWith(".laws-lois.justice.gc.ca"))) return null;
  const code = new URL(s.url).pathname.match(/\/eng\/acts\/([A-Za-z0-9][A-Za-z0-9.-]*)\/?/i)?.[1];
  if (!code) return null;
  const ev = `${s.title ?? ""} ${s.snippet ?? ""}`;
  const m = ev.match(new RegExp(`(?:^|[^A-Za-z])${escapeRe(statuteName)}\\s*\\((R\\.S\\.C\\.|S\\.C\\.)\\s*,?\\s*(\\d{4}),\\s*c\\.\\s*([A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*)\\)`, "i"));
  if (!m) return null;
  const rsc = /^R/.test(m[1]);
  if (rsc && m[3].toLowerCase() !== code.toLowerCase()) return null;
  return { templateId: "ca.statute.federal", fields: { code: rsc ? "R.S.C." : "S.C.", [rsc ? "revisionYear" : "enactmentYear"]: m[2], chapter: m[3] },
    source: { url: s.url, ...(s.title ? { title: s.title } : {}), basis: "official_record" } };
}

/** Statute records that agree with the supplied code/year/chapter; distinct records stay distinct. */
export function selectStatuteRecords(records: CountryStatuteRecord[], supplied: Record<string, string>): { records: CountryStatuteRecord[]; conflicted: boolean } {
  const same = (a: string, b: string) => a.replace(/[.\s]/g, "").toLowerCase() === b.replace(/[.\s]/g, "").toLowerCase();
  let conflicted = false;
  const unique = new Map<string, CountryStatuteRecord>();
  for (const r of records) {
    const disagree = ["code", "revisionYear", "enactmentYear", "chapter"].some((k) => supplied[k] && r.fields[k] && !same(supplied[k], r.fields[k])) ||
      (supplied.revisionYear && !r.fields.revisionYear) || (supplied.enactmentYear && r.templateId === "ca.statute.federal" && !r.fields.enactmentYear);
    if (disagree) { conflicted = true; continue; }
    const key = JSON.stringify(Object.entries(r.fields).sort());
    if (!unique.has(key) || (BASIS_RANK[r.source.basis] ?? 9) < (BASIS_RANK[unique.get(key)!.source.basis] ?? 9)) unique.set(key, r);
  }
  return { records: [...unique.values()], conflicted };
}

// ── Client acceptance ───────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === "string" ? v : "";
const httpUrl = (u: unknown) => { try { return ["https:", "http:"].includes(new URL(str(u)).protocol); } catch { return false; } };

/** Read untrusted decision records; null unless every record and option is well formed and in scope. */
export function readCountryDecisions(raw: unknown, request: CountryLookupRequest): CountryDecision[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) return null;
  const allowed = TEMPLATES_FOR[`${request.jurisdiction}:${request.kind}`];
  const out: CountryDecision[] = [];
  for (const d of raw) {
    const dr = rec(d);
    if (typeof dr.id !== "string" || typeof dr.label !== "string" || !Array.isArray(dr.options) || !dr.options.length || dr.options.length > 10) return null;
    const options: CountryOption[] = [];
    for (const o of dr.options) {
      const or = rec(o);
      const tmpl = or.templateId as CountryTemplateId;
      if (typeof or.id !== "string" || !allowed.includes(tmpl)) return null;
      const fields = rec(or.fields), sources = rec(or.sources);
      if (!Object.keys(fields).length || Object.entries(fields).some(([k, v]) => !TEMPLATE_KEYS[tmpl].includes(k) || typeof v !== "string" || !v.trim())) return null;
      const src: Record<string, CountryFieldSource> = {};
      for (const k of Object.keys(fields)) {
        const s = rec(sources[k]);
        if (!httpUrl(s.url) || !BASES.has(str(s.basis))) return null;
        src[k] = { url: str(s.url), ...(typeof s.title === "string" ? { title: s.title } : {}), basis: str(s.basis) };
      }
      options.push({ id: or.id, templateId: tmpl, label: countryOptionLabel(tmpl, fields as Record<string, string>), fields: fields as Record<string, string>, sources: src });
    }
    if (new Set(options.map((o) => o.id)).size !== options.length) return null;
    out.push({ id: dr.id, label: dr.label.slice(0, 160), options });
  }
  return new Set(out.map((d) => d.id)).size === out.length ? out : null;
}

/** Compose the template text the local parser must read back as one complete citation. */
export function composeCountryCitation(templateId: CountryTemplateId, f: Record<string, string>): string {
  switch (templateId) {
    case "au.case.neutral": return `${f.caseName} [${f.neutralYear}] ${f.court} ${f.neutralNumber} (${f.decisionDate})`;
    case "au.case.reported": return `${f.caseName} (${f.reporterYear}) ${f.reporterVolume} ${f.reporter} ${f.firstPage}`;
    case "ca.case.scc_neutral": return `${f.caseName}, ${f.neutralYear} SCC ${f.neutralNumber}${f.reporterYear ? `, [${f.reporterYear}] ${f.reporterVolume} ${f.reporter ?? "S.C.R."} ${f.firstPage}` : ""}`;
    case "ca.case.scr": return `${f.caseName}${f.decisionYear ? ` (${f.decisionYear})` : ""}, [${f.reporterYear}] ${f.reporterVolume} ${f.reporter ?? "S.C.R."} ${f.firstPage}`;
    case "au.statute.cth": return `${f.statuteName} ${f.enactmentYear} (${f.code ?? "Cth"})`;
    case "ca.statute.federal": return `${f.statuteName}, ${f.code} ${/^S/.test(f.code ?? "") ? f.enactmentYear : f.revisionYear}, c ${f.chapter}`;
  }
}

function templateOf(request: CountryLookupRequest, f: Record<string, string>): CountryTemplateId | null {
  if (request.kind === "statute") return request.jurisdiction === "AU" ? "au.statute.cth" : "ca.statute.federal";
  if (request.jurisdiction === "AU") return f.neutralNumber || f.court ? "au.case.neutral" : f.reporter ? "au.case.reported" : null;
  return f.neutralYear ? "ca.case.scc_neutral" : f.reporterYear ? "ca.case.scr" : null;
}

export type CountryAcceptance =
  | { kind: "done"; citation: string; templateId: CountryTemplateId; fields: Record<string, string>; provenance: Record<string, { value: string; sourceUrl: string; sourceTitle?: string; basis: string }>; sourceUrls: string[] }
  | { kind: "choice"; stage: "decision" | "location"; decisions: CountryDecision[] }
  | { kind: "fail"; reason: "binding" | "unavailable" | "not_found" | "ambiguous" | "conflict" | "incomplete" };

/**
 * Accept a typed AU/CA response. Supplied values are never replaced; added
 * values need their own grounded source; the merged citation must re-parse as
 * exactly one complete template.
 */
export function acceptCountryResponse(request: CountryLookupRequest, raw: string, response: unknown): CountryAcceptance {
  const r = rec(response), identity = rec(r.identity);
  const bind = (s: string) => s.replace(/״/g, '"').replace(/׳/g, "'").replace(/\s+/g, " ").trim();
  if (bind(request.rawInput) !== bind(raw) || (r.rawInput !== undefined && bind(str(r.rawInput)) !== bind(raw))) return { kind: "fail", reason: "binding" };
  if (r.kind !== request.kind || r.jurisdiction !== request.jurisdiction || (identity.jurisdiction !== undefined && identity.jurisdiction !== request.jurisdiction)) return { kind: "fail", reason: "binding" };
  if (r.error !== undefined) return { kind: "fail", reason: "unavailable" };
  const conflicts = Array.isArray(identity.conflicts) ? identity.conflicts : [];
  if (r.countryDecisions !== undefined && (r.locationChoiceRequired === true || conflicts.includes("ambiguous_record"))) {
    const decisions = readCountryDecisions(r.countryDecisions, request);
    if (!decisions) return { kind: "fail", reason: "binding" };
    if (decisions.length > 1) return { kind: "choice", stage: "decision", decisions };
    if (decisions[0].options.length > 1) return { kind: "choice", stage: "location", decisions };
    return { kind: "fail", reason: "binding" };
  }
  if (conflicts.includes("ambiguous_record")) return { kind: "fail", reason: "ambiguous" };
  if (conflicts.length) return { kind: "fail", reason: "conflict" };
  if (identity.matched !== true) return { kind: "fail", reason: "not_found" };
  const supplied = request.parsedFields;
  const fields = rec(r.fields), grounded = rec(r.grounded), provenance = rec(r.provenance);
  const sources = Array.isArray(r.sources) ? r.sources.map(rec) : [];
  const added: Record<string, string> = {};
  const prov: Extract<CountryAcceptance, { kind: "done" }>["provenance"] = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!COUNTRY_FIELD_KEYS[request.kind].includes(k) || typeof v !== "string" || !v.trim()) return { kind: "fail", reason: "binding" };
    if (supplied[k] !== undefined) {
      if (bind(supplied[k]) !== bind(v)) return { kind: "fail", reason: "conflict" };
      continue;
    }
    const p = rec(provenance[k]);
    if (grounded[k] !== true || p.value !== v || !BASES.has(str(p.basis)) || !httpUrl(p.sourceUrl) || !sources.some((s) => s.url === p.sourceUrl)) return { kind: "fail", reason: "binding" };
    added[k] = v;
    prov[k] = { value: v, sourceUrl: str(p.sourceUrl), ...(typeof p.sourceTitle === "string" ? { sourceTitle: p.sourceTitle } : {}), basis: str(p.basis) };
  }
  if (!Object.keys(added).length) return { kind: "fail", reason: "not_found" };
  const merged = { ...added, ...supplied };
  const templateId = templateOf(request, merged);
  if (!templateId) return { kind: "fail", reason: "incomplete" };
  const composed = composeCountryCitation(templateId, merged);
  const ast = parseCountryLocal(composed, null);
  if (!ast || !ast.complete || ast.templateId !== templateId || ast.jurisdiction !== request.jurisdiction) return { kind: "fail", reason: "incomplete" };
  // The read-back must keep every value exactly (supplied and added alike).
  for (const [k, v] of Object.entries(merged)) {
    if (k === "year" || (k === "decisionYear" && templateId !== "ca.case.scr") || (k === "code" && templateId === "ca.statute.federal")) continue;
    if (k === "decisionYear" && templateId === "ca.case.scr") { if (ast.fields.decisionYear?.value !== v) return { kind: "fail", reason: "incomplete" }; continue; }
    if (ast.fields[k]?.value !== v) return { kind: "fail", reason: "incomplete" };
  }
  if (merged.decisionYear && templateId === "ca.case.scc_neutral" && merged.decisionYear !== merged.neutralYear) return { kind: "fail", reason: "conflict" };
  const citation = renderCountryLocal(ast).citation;
  return { kind: "done", citation, templateId, fields: added, provenance: prov, sourceUrls: [...new Set(Object.values(prov).map((p) => p.sourceUrl))] };
}

/** A single chosen option as a typed response (no IO): only that record's fields and donors. */
export function countryOptionResponse(request: CountryLookupRequest, option: CountryOption, base: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, string> = {}, grounded: Record<string, true> = {}, provenance: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(option.fields)) {
    if (request.parsedFields[k] !== undefined) continue;
    const s = option.sources[k];
    fields[k] = v; grounded[k] = true;
    provenance[k] = { value: v, sourceUrl: s.url, ...(s.title ? { sourceTitle: s.title } : {}), basis: s.basis };
  }
  const sources = [...new Map(Object.values(option.sources).map((s) => [s.url, { url: s.url, ...(s.title ? { title: s.title } : {}), tier: "tier1" }])).values()];
  const identity = rec(base.identity);
  return {
    kind: request.kind, jurisdiction: request.jurisdiction, fields, grounded, provenance, sources,
    identity: { matched: true, anchors: Array.isArray(identity.anchors) ? identity.anchors : [], conflicts: [], jurisdiction: request.jurisdiction },
    diagnostics: rec(base.diagnostics),
  };
}
