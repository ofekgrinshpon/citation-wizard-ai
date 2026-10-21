/** Bounded BB21 T2 AU/CA local evidence. Pure browser/Deno; no identity or completion claims. */
import { escapeCitationLiteral } from './segments.ts';
import { rulepackCapability, rulepackJurisdictionFromId } from './rulepack.ts';
import type { CitationManualChoice, InputSpan } from '../pastedCitation.ts';
export interface CountryField { value: string; spans: InputSpan[] }
export interface CountryAst {
  raw: string; jurisdiction: 'AU' | 'CA'; family: 'case' | 'statute'; templateId: string | null;
  fields: Record<string, CountryField>; unknownSpans: InputSpan[]; missing: string[]; conflicts: string[];
  complete: boolean;
}
/**
 * Structural recognition anchors: identify AU/CA + family from typed citation structure even when the
 * final number/page/chapter/year is missing. Template completeness is decided separately by the
 * template regexes below. Incidental acronyms ("The SCC", "HCA Holdings", "Quicklaw Studies") are not evidence.
 */
export const AU_REPORTER_ANCHOR = /\(\d{4}\)\s+\d+\s+(?:CLR|FCR)\b/;
export const AU_NEUTRAL_ANCHOR = /\[\d{4}\]\s+(?:HCA|FCA|FCAFC)\b/;
export const AU_CODE_ANCHOR = /\((?:Cth)\)|\(Austl\.\)\s*\.?\s*$/;
export const CA_NEUTRAL_ANCHOR = /\b\d{4}\s+(?:SCC|CanLII)\b/;
export const CA_REPORTER_ANCHOR = /\[\d{4}\]\s+\d+\s+(?:S\.C\.R\.|SCR\b)/;
export const CA_CODE_ANCHOR = /(?<![A-Za-z.])(?:R\.?S\.?C\.?|S\.C\.),?\s+\d{4}\b|\(Can\.\)\s*\.?\s*$/;
const AU = new RegExp([AU_REPORTER_ANCHOR, AU_NEUTRAL_ANCHOR, AU_CODE_ANCHOR].map(r => r.source).join('|'));
const CA = new RegExp([CA_NEUTRAL_ANCHOR, CA_REPORTER_ANCHOR, CA_CODE_ANCHOR].map(r => r.source).join('|'));
/** Missing final element named by the recognized-but-incomplete structure (never a guessed value). */
function partialMissing(s: string, jurisdiction: 'AU' | 'CA', family: 'case' | 'statute'): string[] {
  if (family === 'case') {
    if (jurisdiction === 'AU') return /\[\d{4}\]\s+(?:HCA|FCA|FCAFC)\s*$/.test(s) ? ['neutralNumber'] : /(?:CLR|FCR)\s*$/.test(s) ? ['firstPage'] : [];
    return /\bSCC\s*$/.test(s) ? ['neutralNumber'] : /(?:S\.C\.R\.|SCR)\s*$/.test(s) ? ['firstPage'] : [];
  }
  if (jurisdiction === 'AU') return /\bAct\s*\(Cth\)/.test(s) ? ['enactmentYear'] : [];
  return /(?:R\.?S\.?C\.?|S\.C\.),?\s+\d{4}\s*$/.test(s) ? ['chapter'] : [];
}
const NUMS = String.raw`\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–-]\s*\d+)?)*`;
const LOC_NUMBER = String.raw`\d+[A-Za-z]?(?:\([\da-z]+\))*(?:\s*[–-]\s*\d+[A-Za-z]?(?:\([\da-z]+\))*)?`;
const LOC_UNIT = String.raw`(?:s|ss|pt|pts|div|divs|sch|schs)\.?`;
const LOC_GROUP = String.raw`${LOC_UNIT}\s+${LOC_NUMBER}(?:\s*(?:,|and)\s*(?:${LOC_UNIT}\s+)?${LOC_NUMBER})*`;
/** Typed unit/number groups; distinct units may follow each other without commas (pt 2 div 3 s 4). */
const LOC = new RegExp(String.raw`^${LOC_GROUP}(?:\s+${LOC_GROUP})*$`);
/** Recognize country+family even when incomplete; a compatible manual choice is not supplied identity. */
export function parseCountryLocal(raw: string, manual: CitationManualChoice | null = null): CountryAst | null {
  const au = AU.test(raw), ca = CA.test(raw);
  const mj = manual?.jurisdiction ?? rulepackJurisdictionFromId(manual?.jurisdictionId);
  const caseShape = /\s(?:v\.?|c\.)\s/u.test(raw.split(',')[0]) || [AU_REPORTER_ANCHOR, AU_NEUTRAL_ANCHOR, CA_NEUTRAL_ANCHOR, CA_REPORTER_ANCHOR].some(r => r.test(raw));
  const statuteShape = /\b(?:Act|Cth|R\.?S\.?C\.?)\b|\bS\.C\./.test(raw);
  const mk = manual?.sourceType?.startsWith('foreign_case_') ? 'case' : manual?.sourceType?.startsWith('foreign_statute_') || manual?.sourceType === 'primary_legislation' ? 'statute' : null;
  if (!au && !ca && !((mj === 'AU' || mj === 'CA') && (caseShape || statuteShape || mk))) return null;
  const jurisdiction = au ? 'AU' : ca ? 'CA' : mj === 'AU' ? 'AU' : 'CA';
  const family = caseShape ? 'case' : statuteShape ? 'statute' : mk ?? 'case';
  const ast: CountryAst = { raw, jurisdiction, family, templateId: null, fields: {}, unknownSpans: [], missing: [], conflicts: [], complete: false };
  if (au && ca) ast.conflicts.push('mixed_countries');
  if (manual?.subjurisdiction || manual?.jurisdictionId?.includes('/')) ast.conflicts.push('unsupported_subjurisdiction');
  if (mj && mj !== 'UNKNOWN' && mj !== jurisdiction) ast.conflicts.push('manual_country_conflict');
  if (mk && mk !== family || manual?.sourceType && !['foreign', 'unknown'].includes(manual.sourceType) && !mk) ast.conflicts.push('manual_family_conflict');
  const s = raw.trim().replace(/\.$/, '').replace(/\s*\((?:Austl|Can)\.\)$/, '').trim();
  const base = raw.indexOf(s);
  let coveredEnd = 0;
  const put = (key: string, value: string | undefined, start?: number) => {
    if (!value) return;
    const at = start ?? raw.indexOf(value);
    if (at >= 0) ast.fields[key] = { value, spans: [{ start: at, end: at + value.length }] };
  };
  const match = (re: RegExp, id: string) => {
    const indexed = new RegExp(re.source, re.flags + 'd');
    const m = indexed.exec(s); if (!m) return null;
    ast.templateId = id; coveredEnd = m[0].length;
    for (const [k,v] of Object.entries(m.groups ?? {})) {
      const range = (m as RegExpExecArray & { indices?: { groups?: Record<string, [number, number]> } }).indices?.groups?.[k];
      put(k, v, range ? base + range[0] : undefined);
    }
    return m;
  };
  const pin = String.raw`(?:,?\s*(?:(?<paragraphLabel>paras?\.?|¶+)\s*(?<paragraph>${NUMS})|(?<pagePinpoint>${NUMS})))?`;
  if (jurisdiction === 'AU' && family === 'case') {
    if (/\b(?:HCA|FCA|FCAFC)\b/.test(s)) {
      match(new RegExp(String.raw`^(?<caseName>.+?)\s*\[(?<neutralYear>\d{4})\]\s+(?<court>HCA|FCA)\s+(?<neutralNumber>\d+)(?:\s*\((?<decisionDate>\d{1,2}\s+[A-Za-z]+\s+\d{4})\))?(?:,?\s*\[(?<paragraph>${NUMS})\])?`), 'au.case.neutral');
      if (ast.templateId && !ast.fields.decisionDate) ast.missing.push('decisionDate');
      const date = ast.fields.decisionDate?.value;
      if (date) {
        const dm = /^(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/.exec(date);
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        if (!dm || Number(dm[1]) < 1 || Number(dm[1]) > new Date(Date.UTC(Number(dm[3]), months.indexOf(dm[2]) + 1, 0)).getUTCDate()) ast.conflicts.push('invalid_decision_date');
        else put('decisionYear', dm[3], ast.fields.decisionDate.spans[0].end - 4);
      }
    } else match(new RegExp(String.raw`^(?<caseName>.+?)\s*\((?<reporterYear>\d{4})\)\s+(?<reporterVolume>\d+)\s+(?<reporter>CLR|FCR)\s+(?<firstPage>\d+)${pin}`), 'au.case.reported');
  } else if (jurisdiction === 'CA' && family === 'case') {
    if (/\bSCC\b/.test(s)) {
      match(new RegExp(String.raw`^(?<caseName>.+?),?\s+(?<neutralYear>\d{4})\s+SCC\s+(?<neutralNumber>\d+)(?:,\s*\[(?<reporterYear>\d{4})\]\s+(?<reporterVolume>\d+)\s+(?<reporter>S\.C\.R\.|SCR)\s+(?<firstPage>\d+))?${pin}`), 'ca.case.scc_neutral');
    } else match(new RegExp(String.raw`^(?<caseName>.+?)(?:\s*\((?<decisionYear>\d{4})\))?,\s*\[(?<reporterYear>\d{4})\]\s+(?<reporterVolume>\d+)\s+(?<reporter>S\.C\.R\.|SCR)\s+(?<firstPage>\d+)${pin}`), 'ca.case.scr');
    if (ast.fields.reporterYear && Number(ast.fields.reporterYear.value) < 1975) ast.conflicts.push('scr_before_1975');
  } else if (jurisdiction === 'AU') {
    match(/^(?<statuteName>.+?\bAct)\s+(?<enactmentYear>\d{4})\s*\((?<code>Cth)\)(?:\s+(?<subdivisions>.*))?$/, 'au.statute.cth');
  } else {
    match(/^(?<statuteName>[^,]*[^,\s]),\s*(?<code>R\.?S\.?C\.?|S\.?C\.?),?\s+(?<revisionYear>\d{4}),\s*c\.?\s+(?<chapter>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?:,?\s+(?<subdivisions>.*))?$/, 'ca.statute.federal');
  }
  if (ast.templateId === 'ca.statute.federal' && /^S/.test(ast.fields.code?.value ?? '')) {
    ast.fields.enactmentYear = ast.fields.revisionYear;
    delete ast.fields.revisionYear;
  }
  if (family === 'case' && ast.templateId && !/\s(?:v\.?|c\.)\s|^(?:In re|Ex parte)\s/.test(ast.fields.caseName?.value ?? '')) ast.conflicts.push('ambiguous_parties');
  const subdivisions = ast.fields.subdivisions;
  if (subdivisions && !LOC.test(subdivisions.value)) ast.conflicts.push('unsupported_subdivisions_or_tail');
  if (coveredEnd < s.length) ast.unknownSpans.push({ start: base + coveredEnd, end: base + s.length });
  if (!ast.templateId) ast.missing.push(...partialMissing(s, jurisdiction, family), 'supported_template');
  ast.complete = !!ast.templateId && !ast.missing.length && !ast.conflicts.length && !ast.unknownSpans.length;
  return ast;
}
export function renderCountryLocal(ast: CountryAst) {
  const cap = rulepackCapability(ast.family, ast.jurisdiction, ast.templateId ?? 'unsupported');
  const eligible = ast.complete && cap.local;
  const f = (k: string) => ast.fields[k]?.value ?? '';
  const e = (k: string) => escapeCitationLiteral(f(k));
  const italic = (s: string) => `##${escapeCitationLiteral(s)}##`;
  const caName = () => {
    const n = f('caseName');
    return escapeCitationLiteral(n).replace(/(^|\s)(In re|Ex parte|ex rel\.)(?=\s|$)/g, (_m, pre: string, phrase: string) => `${pre}##${phrase}##`);
  };
  let citation = escapeCitationLiteral(ast.raw);
  if (eligible) {
    const paragraph = f('paragraph') ? `, para${/[,–-]/.test(f('paragraph')) ? 's' : ''}. ${e('paragraph')}` : '';
    const page = f('pagePinpoint') ? `, ${e('pagePinpoint')}` : '';
    switch(ast.templateId) {
      case 'au.case.reported': citation = `${italic(f('caseName'))} (${e('reporterYear')}) ${e('reporterVolume')} ${e('reporter')} ${e('firstPage')}${paragraph || page} (Austl.).`; break;
      case 'au.case.neutral': citation = `${italic(f('caseName'))} [${e('neutralYear')}] ${e('court')} ${e('neutralNumber')} (${e('decisionDate')})${f('paragraph') ? ` [${e('paragraph')}]` : ''} (Austl.).`; break;
      case 'au.statute.cth': citation = `${italic(`${f('statuteName')} ${f('enactmentYear')}`)} (Cth)${f('subdivisions') ? ` ${e('subdivisions')}` : ''} (Austl.).`; break;
      case 'ca.case.scc_neutral': citation = `${caName()}, ${e('neutralYear')} SCC ${e('neutralNumber')}${f('reporterYear') ? `, [${e('reporterYear')}] ${e('reporterVolume')} S.C.R. ${e('firstPage')}` : ''}${paragraph || page} (Can.).`; break;
      case 'ca.case.scr': citation = `${caName()}${f('decisionYear') && f('decisionYear') !== f('reporterYear') ? ` (${e('decisionYear')})` : ''}, [${e('reporterYear')}] ${e('reporterVolume')} S.C.R. ${e('firstPage')}${paragraph || page} (Can.).`; break;
      case 'ca.statute.federal': citation = `${e('statuteName')}, ${/^R/.test(f('code')) ? 'R.S.C.' : 'S.C.'} ${e(/^R/.test(f('code')) ? 'revisionYear' : 'enactmentYear')}, c ${e('chapter')}${f('subdivisions') ? `, ${e('subdivisions')}` : ''} (Can.).`; break;
    }
  }
  const warningMsg = eligible ? 'עוצב לפי הפרטים שסופקו; זהות המקור לא אומתה.' : ast.missing.includes('decisionDate') ? 'חסר תאריך מלא של פסק הדין; הוסיפו יום, חודש ושנה. הקלט נשמר ללא חיפוש.' : 'התבנית אינה זמינה, חסרה או מכילה פרטים סותרים/לא נתמכים; בדקו את פרטי המקור. הקלט נשמר ללא חיפוש.';
  return { citation, reply: `${citation}\n⚠️ ${warningMsg}`, warningMsg, status: 'warning' as const };
}
