import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTRY_LOCAL_FIXTURES as fixtures } from './fixtures/countryLocalFixtures';
import { parseCountryLocal, renderCountryLocal } from '../../supabase/functions/_shared/citationPure/countryLocal';
import { RULEPACK_MANIFEST, rulepackCapability, rulepackLookupEligible } from '../../supabase/functions/_shared/citationPure/rulepack';
import { guardPastedCitationRequest } from '../../supabase/functions/_shared/pastedCitation';
import { runCitation, planForeignLookup } from '@/lib/runCitation';
import { citationManualChoice, preparePastedCitation } from '@/lib/pastedCitationAdapter';
import { citationToHtml, citationToPlain } from '@/lib/citationRichText';
import { parseCitationSegments } from '@/lib/citationSegments';
const m = vi.hoisted(() => ({ cache: vi.fn(), classifier: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/verifiedSources', () => ({ findVerifiedSourceMatch: m.cache }));
vi.mock('@/lib/sourceTypeClassifier', () => ({ resolveSourceType: m.classifier }));
vi.mock('@/lib/functionError', () => ({ invokeFunction: m.invoke }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: m.invoke } } }));
beforeEach(() => { vi.clearAllMocks(); m.cache.mockResolvedValue({ source_name: '', full_citation: 'UNSAFE CACHE' }); vi.stubGlobal('fetch', vi.fn(() => { throw Error('offline'); })); });
afterEach(() => vi.unstubAllGlobals());
const ast = (raw: string) => { const a = parseCountryLocal(raw); if (!a) throw Error('country not detected'); return a; };
const render = (raw: string) => renderCountryLocal(ast(raw));
const zero = () => { expect(m.cache).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); };
describe('six BB21 exact local templates', () => {
  for (const f of fixtures) {
    it(`${f.id} natural AST/render and repeat/warm-cache runner`, async () => {
      const a = ast(f.raw); expect(a.templateId).toBe(f.id); expect(a.complete).toBe(true); expect(a.unknownSpans).toEqual([]);
      expect(renderCountryLocal(a).citation).toBe(f.output);
      for (let n = 0; n < 2; n++) { const r = await runCitation({ rawInput: f.raw }); expect(r.citation).toBe(f.output); expect(r.fromVerifiedStore).toBe(false); expect(r.pastedCitation?.rawInput).toBe(f.raw); }
      zero();
    });
    it(`${f.id} compatible manual country/family and original UTF16 spans`, async () => {
      const raw = f.raw.replace(f.j === 'AU' ? 'Wattle' : 'Maple', 'Érable🙂').replace('Synthetic', 'Synthetíc');
      const type = f.id.includes('case') ? 'foreign_case_other' : 'foreign';
      const choice = citationManualChoice(type, f.j === 'AU' ? 't2:australia' : 't2:canada');
      const a = parseCountryLocal(raw, choice); expect(a?.complete).toBe(true);
      for (const field of Object.values(a?.fields ?? {})) for (const s of field.spans) expect(raw.slice(s.start,s.end)).toBe(field.value);
      const r = await runCitation({ rawInput: raw, overrideType: type, manualChoice: choice }); expect(r.citation).toBe(render(raw).citation); zero();
    });
    it(`${f.id} exact toggle does not inherit sibling eligibility`, async () => {
      const entry = RULEPACK_MANIFEST.find(e => e.id === f.id); if (!entry) throw Error('missing entry');
      const status = entry.status;
      try {
        entry.status = 'planned_disabled';
        expect(rulepackCapability(f.id.includes('case') ? 'case' : 'statute', f.j, f.id).local).toBe(false);
        const r = await runCitation({ rawInput: f.raw }); expect(citationToPlain(r.citation)).toBe(f.raw); zero();
        for (const other of fixtures.filter(x => x.j === f.j && x.id !== f.id)) expect(render(other.raw).citation).toBe(other.output);
      } finally { entry.status = status; }
    });
    it(`${f.id} wrong country and wrong family preserve before IO`, async () => {
      for (const choice of [citationManualChoice('foreign_case_other', f.j === 'AU' ? 't2:canada' : 't2:australia'), citationManualChoice(f.id.includes('case') ? 'foreign_book' : 'foreign_case_other', f.j === 'AU' ? 't2:australia' : 't2:canada')]) {
        const r = await runCitation({ rawInput: f.raw, manualChoice: choice }); expect(citationToPlain(r.citation)).toBe(f.raw); expect(r.pastedCitation?.conflicts.length).toBeGreaterThan(0);
      } zero();
    });
    it(`${f.id} server refuses typed/forged UNKNOWN and generic completion`, () => {
      for (const lookup of [undefined, { enabled: true, rawInput: f.raw, kind: f.id.includes('case') ? 'case' : 'statute', jurisdiction: 'UNKNOWN', parsedFields: {} }]) {
        const c = guardPastedCitationRequest({ messages: [{ role:'user', content:f.raw }], rawInput:f.raw, foreignLookup:lookup }); expect(c.route).toBe('preserve'); expect(c.jurisdiction).toBe(f.j);
      }
      expect(rulepackLookupEligible(f.id.includes('case') ? 'case' : 'statute', f.j)).toBe(false); expect(planForeignLookup('foreign_case_other', f.raw, null)).toBeNull();
    });
  }
});
it.each([
  ['Synthetic Records Act 2020 (Cth)', '##Synthetic Records Act 2020## (Cth) (Austl.).'],
  ['Synthetic Records Act, S.C. 2020, c 8', 'Synthetic Records Act, S.C. 2020, c 8 (Can.).'],
  ['Synthetic Records Act, R.S.C., 1985, c. C-46, s 4(1)(a)', 'Synthetic Records Act, R.S.C. 1985, c C-46, s 4(1)(a) (Can.).'],
  ['Wattle v Harbour [No. 2] (2020) 270 FCR 10, 14', '##Wattle v Harbour [No. 2]## (2020) 270 FCR 10, 14 (Austl.).'],
  ['Érable c. Cèdre, 2020 SCC 12, [2021] 2 SCR 100, para. 8', 'Érable c. Cèdre, 2020 SCC 12, [2021] 2 S.C.R. 100, para. 8 (Can.).'],
  ['Maple v. Cedar (2019), [2020] 2 SCR 100, 104', 'Maple v. Cedar (2019), [2020] 2 S.C.R. 100, 104 (Can.).'],
  ['Maple v. Cedar, [1975] 2 SCR 100, para. 104', 'Maple v. Cedar, [1975] 2 S.C.R. 100, para. 104 (Can.).'],
])('supplied alias/optional/year roles %s', async (raw, output) => { expect((await runCitation({ rawInput:raw })).citation).toBe(output); zero(); });
it.each([
 'Wattle v Harbour [2020] FCA 123', 'Wattle v Harbour [2020] FCAFC 123 (4 March 2020)',
 'Maple v. Cedar, [1974] 2 SCR 100', 'Wattle v Harbour (2020) 270 CLR 10, 14, 2 XYZ 19',
 'Synthetic Records Act 2020 (Cth) ss 4–6 amended 2023', 'Wattle v Harbour [2020] HCA 1 (31 February 2020)',
 'Maple v. Cedar, 2020 CanLII 12', 'Wattle v Harbour (2020) 270 CLR 10 (Can.).',
 'Synthetic Records Regulations 2020 (Cth)', 'Wattle v Harbour [2020] HCA 1 (4 March 2020), No. 22',
])('unsupported/missing/tail stays raw %s', async raw => { const r = await runCitation({ rawInput:raw }); expect(citationToPlain(r.citation)).toBe(raw); expect(r.status).toBe('warning'); zero(); });
it('literal markers and HTML remain literal inside semantic party italics', async () => {
 const raw = 'Wattle C## x^^ <b>É</b> v Harbour (2020) 270 CLR 10'; const r = await runCitation({ rawInput:raw });
 expect(citationToPlain(r.citation)).toBe(`${raw} (Austl.).`);
 expect(parseCitationSegments(r.citation).filter(x=>x.italic).map(x=>x.text)).toEqual(['Wattle C## x^^ <b>É</b> v Harbour']);
 expect(citationToHtml(r.citation)).toContain('&lt;b&gt;É&lt;/b&gt;'); zero();
});
it('neutral year and full decision year remain independent', () => { const a = ast('Wattle v Harbour [2020] HCA 1 (4 March 2021)'); expect(a.fields.neutralYear.value).toBe('2020'); expect(a.fields.decisionYear.value).toBe('2021'); });
it('page and explicit paragraph roles remain separate', () => { expect(ast(fixtures[4].raw).fields.pagePinpoint.value).toBe('104'); expect(ast(fixtures[4].raw).fields.paragraph).toBeUndefined(); });
it('incomplete country choice stops legacy', async () => { const r = await runCitation({ rawInput:'Wattle v Harbour', manualChoice:citationManualChoice('foreign_case_other','t2:australia') }); expect(r.citation).toBe('Wattle v Harbour'); zero(); });

it.each([
 'Synthetic Records Act 2020 (Cth) pts 2–3, divs 4–6, schs 1–2',
 'Synthetic Records Act 2020 (Cth) ss 4(1)(a)–6(2), 8',
 'Synthetic Records Act, S.C. 2020, c 8, pt 2, div 3, sch 1',
])("typed nested subdivision stays supplied: %s", async raw => { expect(citationToPlain((await runCitation({rawInput:raw})).citation)).toBe(`${raw} (${raw.includes('Cth')?'Austl.':'Can.'}).`); zero(); });
it.each([
 'Wattle v Harbour (2020) 270 CLR 10 347 U.S. 483 (1954)',
 'Maple v Cedar, 2020 SCC 12 R v Smith [2001] UKHL 1',
 'Wattle v Harbour (2020) 270 CLR 10 ע"א 1234/20 כהן נ׳ לוי',
])('mixed country/Israeli evidence cannot be erased %s', async raw => { const r = await runCitation({rawInput:raw}); expect(citationToPlain(r.citation)).toBe(raw); expect(r.pastedCitation?.conflicts.length).toBeGreaterThan(0); zero(); });
it('repeated equal years bind exact original occurrence', () => { const a = ast('Maple v Cedar (2020), [2020] 2 SCR 100'); expect(a.fields.decisionYear.spans[0].start).not.toBe(a.fields.reporterYear.spans[0].start); });

it('SC enactment year is not an RSC revision year', () => { const a = ast('Synthetic Records Act, S.C. 2020, c 8'); expect(a.fields.enactmentYear.value).toBe('2020'); expect(a.fields.revisionYear).toBeUndefined(); });

it('state/provincial manual subjurisdiction never borrows federal template', async () => { const raw = fixtures[0].raw; const r = await runCitation({rawInput:raw,manualChoice:{jurisdiction:'AU',jurisdictionId:'t2:australia',subjurisdiction:'t2:australia/nsw',sourceType:'foreign_case_other'}}); expect(citationToPlain(r.citation)).toBe(raw); zero(); });
