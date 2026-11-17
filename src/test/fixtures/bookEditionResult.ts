import { resolveBookCompletion } from '../../../supabase/functions/_shared/citationPure/bookFinal';
export const editionRaw = 'National Identity by Anthony D. Smith';
/** Synthetic authority evidence, passed through the real pure resolver. No network. */
export function bookEditionResult(raw = editionRaw) {
  const fields = {authors:'Anthony D. Smith',bookTitle:'National Identity'};
  const request = {kind:'book',jurisdiction:'OTHER',rawInput:raw,parsedFields:fields};
  const response = {kind:'book',jurisdiction:'OTHER',fields:{},grounded:{},provenance:{},identity:{matched:true,anchors:['title:National Identity'],conflicts:['year:editions:1991,1993']},
    sources:['1991','1993'].map(year=>({url:`https://books.google.com/books?id=${year}`,title:'National Identity by Anthony D. Smith',snippet:`Anthony D. Smith, National Identity (${year})`,tier:'tier1',strong:true}))};
  const result = resolveBookCompletion(request,raw,response,fields,undefined,['year']);
  if (!result.bookEditionChoice) throw new Error('Fixture must produce a real edition choice');
  return {...result,reply:result.citation,fromVerifiedStore:false,sourceType:'foreign_book'};
}
