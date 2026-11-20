import { describe, expect, it } from 'vitest';
import { readRenderedHebrewArticleFields as read } from '../../supabase/functions/_shared/hebrewArticleValidation';
import { validateAIResponse } from '../lib/citationValidation';
const title='פיצוי נאות: על סעדים וצדק בדיני הנטילה השלטונית בישראל';
const stern=`שי שטרן "${title}" **עיוני משפט** 141 (2018).`;
describe('Hebrew article structured validation', () => {
 it('keeps Stern opening page without inventing a volume', () => {
  expect(read(stern)).toEqual({author:'שי שטרן',articleTitle:title,journalName:'עיוני משפט',firstPage:'141',year:'2018'});
  expect(validateAIResponse(stern,'article').missingFields).toEqual([]);
 });
 it.each(['מא 141','41(2) 141','מא 141, 155–157'])('reads known volume/page slots %s', slots => {
  expect(read(stern.replace('141',slots)).firstPage).toBe('141');
  expect(validateAIResponse(stern.replace('141',slots),'article').isComplete).toBe(true);
 });
 it('retains nested straight quotations and entire subtitle', () => {
  const nested='"אני מחליט עליי" — פרטיות של ילדים בעידן הדיגיטלי והזכות לחזרה מהסכמה הורית';
  expect(read(`סאני כלב "${nested}" **עיוני משפט** מא 61 (2018).`).articleTitle).toBe(nested);
 });
 it('does not borrow source artifacts or warning placeholders', () => {
  expect(validateAIResponse(stern+'\nמקור: 2021 עמ׳ 999\n⚠️ [חסר: עמוד ראשון]','article').missingFields).toEqual([]);
  expect(validateAIResponse(stern.replace('141','[חסר: עמוד ראשון]')+'\nמקור: 141 (2018)','article').missingFields).toEqual(['firstPage']);
 });
 it('reports all actual missing identity fields and year', () => {
  expect(validateAIResponse('[חסר: מחבר] "[חסר: שם המאמר]" **[חסר: כתב עת]** 141 ([חסר: שנה]).','article').missingFields).toEqual(['author','articleTitle','journalName','year']);
 });
 it('does not mistake a pinpoint for an opening page', () => {
  expect(read(stern.replace('141','מא [חסר: עמוד ראשון], 141')).firstPage).toBeUndefined();
 });
 it('accepts a Hebrew year and an explicit year volume', () => {
  expect(read(stern.replace('(2018)','(התשע״ח)')).year).toBe('התשע״ח');
  expect(read(stern.replace('141 (2018)','התשע״ח 141')).year).toBe('התשע״ח');
 });
 it('does not use unstructured citation-like source text', () => {
  expect(read('מקורות:\n'+stern)).toEqual({});
 });
});

import { buildHebrewArticleValidation, readHebrewArticleValidation } from '../../supabase/functions/_shared/hebrewArticleValidation';
import { validateHebrewArticleResponse } from '../lib/citationValidation';
import { createHebrewArticleRequest, resolveHebrewArticle, renderHebrewArticle } from '../../supabase/functions/_shared/hebrewArticleEvidence';
describe('bound Hebrew article validation projection', () => {
 it('uses final fields and preserves unmatched supplied title with honest gaps', () => {
  const resolved=resolveHebrewArticle(createHebrewArticleRequest(title), []);
  const content=renderHebrewArticle(resolved);
  const envelope=buildHebrewArticleValidation(title,content,resolved.fields);
  expect(envelope.fields.articleTitle).toBe(title);
  expect(validateHebrewArticleResponse(content,title,envelope).missingFields).toEqual(['author','journalName','firstPage','year']);
 });
 it('validates Stern from structured final fields', () => {
  const e=buildHebrewArticleValidation(title,stern,read(stern));
  expect(validateHebrewArticleResponse(stern,title,e).isComplete).toBe(true);
 });
 it('rejects stale binding and unknown/invalid fields', () => {
  const e=buildHebrewArticleValidation(title,stern,read(stern));
  expect(readHebrewArticleValidation(e,title+' edit',stern)).toBeNull();
  expect(readHebrewArticleValidation(e,title,stern+' edit')).toBeNull();
  for(const fields of [{...e.fields,verified:'true'},{...e.fields,firstPage:'[חסר: עמוד ראשון]'},{...e.fields,year:2018}]) {
   expect(readHebrewArticleValidation({...e,fields},title,stern)).toBeNull();
  }
 });
 it('falls back to honest rendered slots for absent/stale projections', () => {
  const content=stern.replace('141','[חסר: עמוד ראשון]');
  const e=buildHebrewArticleValidation(title,stern,read(stern));
  expect(validateHebrewArticleResponse(content,title,e).missingFields).toEqual(['firstPage']);
 });
});
