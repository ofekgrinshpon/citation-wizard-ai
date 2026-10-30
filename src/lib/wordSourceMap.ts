import { createHebrewArticleRequest, isCompleteHebrewArticle, renderHebrewArticle, normalizeArticleText } from "../../supabase/functions/_shared/hebrewArticleEvidence";
import type { DocxFootnote } from './docxFootnoteRoundtrip';
import { planWordFootnote, type ExplanationSpan } from './wordFootnotePlan';
import { preparePastedCitation } from './pastedCitationAdapter';
import { citationTextOnly } from './citationSegments';
import { rawCitationFingerprint } from '../../supabase/functions/_shared/pastedCitation';
import { extractWorkIdentifiers } from '../../supabase/functions/_shared/workIdentifiers';

/** Versioned LOCAL deterministic mapping. No semantic-model endpoint or invented source boundaries. */
export interface WordSourceIdentity { key: string; kind: 'case' | 'doi' | 'journal_article'; provenance: 'supplied_identifier'; verified: false; pinpoint: string; pinpointKind: "page" | "paragraph" | null }
export interface WordMappedSource { sourceId: string; start: number; end: number; input: string; crossesRuns: boolean; identity: WordSourceIdentity | null }
export interface WordSourceMap { version: 1; noteId: string; fingerprint: string; kind: 'mapped' | 'protected' | 'unresolved'; sources: WordMappedSource[]; reason?: string }

/** Only complete supported court citations or a stand-alone DOI establish an
 * occurrence identity here. Shared parser evidence is not verification of truth.
 * Exact tuple equality is intentionally stricter than title/author similarity.
 */
export function wordSourceIdentity(raw: string): WordSourceIdentity | null {
  const plain = citationTextOnly(raw).trim();
  const identifiers = extractWorkIdentifiers(plain);
  if (!identifiers.conflicts.length && identifiers.doi && !identifiers.text && !identifiers.sourceUrl)
    return {kind:'doi',key:`doi:${identifiers.doi}`,provenance:'supplied_identifier',verified:false,pinpoint:'',pinpointKind:null};
  if (/[א-ת]/u.test(plain)) {
    const request=createHebrewArticleRequest(plain),fields=request.supplied;
    const result={request,fields,provenance:{},conflicts:[],matched:false};
    const rendered=renderHebrewArticle(result);
    // Exact round-trip token order: no dropped explanation or unrepresented fields.
    if(request.suppliedCitation && isCompleteHebrewArticle(result) && !rendered.includes("⚠") &&
      normalizeArticleText(citationTextOnly(rendered))===normalizeArticleText(plain) &&
      (!request.pinpoint || /^\d+(?:[-–]\d+)?$/.test(request.pinpoint))) {
      return {kind:'journal_article',key:JSON.stringify(['IL-journal',...['author','articleTitle','journalName','volume','notebook','firstPage','year','hebrewYear'].map(k=>fields[k as keyof typeof fields]??'')]),
        provenance:'supplied_identifier',verified:false,pinpoint:request.pinpoint,pinpointKind:request.pinpoint?"page":null};
    }
  }
  const prepared = preparePastedCitation(plain), d = prepared.detection;
  if (!d || d.kind !== 'case' || d.confidence !== 'deterministic' || !prepared.local || prepared.contract.conflicts.length || prepared.contract.route === 'preserve') return null;
  const f = d.fields as Record<string, unknown>;
  if (f.parallel || f.unparsedRemainder || !f.caseName || !f.year || (!f.neutral && !(f.volume && f.reporter && f.firstPage))) return null;
  // Parallel reporters may carry additional locators; a single short suffix
  // cannot preserve them, so the guard above retains their full citation.
  const tuple = [d.jurisdiction,...['caseName','year','court','neutral','volume','reporter','firstPage','docket','decisionDate','parallel'].map(k => String(f[k] ?? '').trim())];
  if(f.pinpoint && f.paragraph || f.starPinpoint)return null;
  const pinpoint = String(f.pinpoint ?? f.paragraph ?? '').trim();
  const pinpointKind = pinpoint ? (f.paragraph ? 'paragraph' as const : 'page' as const) : null;
  // Unhandled pinpoint syntax must not disappear in a repeated form.
  if (pinpoint && !/^\d+(?:[-–]\d+)?$/.test(pinpoint)) return null;
  return {kind:'case',key:JSON.stringify(tuple),provenance:'supplied_identifier',verified:false,pinpoint,pinpointKind};
}

export function mapWordSources(note: DocxFootnote, explanations: readonly ExplanationSpan[]): WordSourceMap {
  const base = {version:1 as const,noteId:note.id,fingerprint:rawCitationFingerprint(note.text)};
  // Reuse all range, surrogate, overlap and structure validation.
  const ordinary = planWordFootnote(note,explanations);
  if (ordinary.kind === 'candidate') return {...base,kind:'mapped',sources:[{
    sourceId:`${note.id}:${ordinary.start}:${ordinary.end}`,start:ordinary.start,end:ordinary.end,input:ordinary.input,
    crossesRuns:ordinary.crossesRuns,identity:wordSourceIdentity(ordinary.input),
  }]};
  if (ordinary.kind === 'protected') return {...base,kind:'protected',sources:[],reason:ordinary.reason};
  // Candidate delimiters are NOT sufficient evidence. Each resulting span must
  // independently satisfy the strict supplied-identifier grammar above.
  const spans=[...explanations].sort((a,b)=>a.start-b.start), gaps:ExplanationSpan[]=[];
  let cursor=0;for(const span of spans){gaps.push({start:cursor,end:span.start});cursor=span.end;}gaps.push({start:cursor,end:note.text.length});
  const sources:WordMappedSource[]=[];
  for(const gap of gaps){
    const raw=note.text.slice(gap.start,gap.end);
    // Split only explicit semicolon/paragraph delimiters. A semicolon inside a
    // title/identifier causes a grammar failure; no fallback concatenation.
    for(const match of raw.matchAll(/[^;؛\n\r]+/gu)){
      const leading=match[0].match(/^[\s,;؛:–—-]*/u)![0].length;
      const trailing=match[0].slice(leading).match(/[\s,;؛:–—-]*$/u)![0].length;
      const start=gap.start+match.index!+leading,end=gap.start+match.index!+match[0].length-trailing;
      if(end<=start)continue;
      const input=note.text.slice(start,end),identity=wordSourceIdentity(input);
      if(!identity)return {...base,kind:'unresolved',sources:[],reason:ordinary.reason};
      const p=planWordFootnote(note,[...(start?[{start:0,end:start}]:[]),...(end<note.text.length?[{start:end,end:note.text.length}]:[])]);
      if(p.kind!=='candidate')return {...base,kind:'unresolved',sources:[],reason:ordinary.reason};
      sources.push({sourceId:`${note.id}:${start}:${end}`,start,end,input,crossesRuns:p.crossesRuns,identity});
      if(sources.length>100)return {...base,kind:'unresolved',sources:[],reason:'מספר המקורות בהערה חורג מהמגבלה.'};
    }
  }
  return sources.length ? {...base,kind:'mapped',sources} : {...base,kind:'unresolved',sources:[],reason:ordinary.reason};
}

/** Rebind immediately before dispatch: neither a stale response nor arbitrary
 * caller-provided offsets are a trusted source map. Protected text never enters input. */
export function validateWordSource(note: DocxFootnote, explanations: readonly ExplanationSpan[], source: WordMappedSource): boolean {
  return mapWordSources(note,explanations).sources.some(s=>s.sourceId===source.sourceId && s.start===source.start && s.end===source.end && s.input===source.input);
}
