import { describe, it, expect, vi } from "vitest";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";
import { buildForeignArticleRequest, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
const doi = '10.2307/1321160';
const bib = `@article{w, title={The Right to Privacy}, author={Samuel D. Warren and Louis D. Brandeis}, journal={Harvard Law Review}, year=1890, volume=4, pages={193--220}, doi={${doi}}}`;
async function run(page: string | Error, raw = doi) {
  const pages: Array<{url: string; accept: string | null}> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === 'https://api.perplexity.ai/search') return new Response(JSON.stringify({results: []}), {status:200});
    pages.push({url:String(url), accept:new Headers(init?.headers).get('Accept')});
    if (page instanceof Error) throw page;
    return new Response(page, {status:200});
  }) as unknown as typeof fetch;
  const input = buildForeignArticleRequest(raw);
  return {input, result:await runForeignLookup(input, {fetchImpl, apiKey:'offline-only'}), pages};
}
describe('exact DOI resolver rescue', () => {
  it('rescues exact article export when discovery returns no source', async () => {
    const {result, input, pages} = await run(bib);
    expect(result.articleResolution).toBe('resolved');
    expect(result.fields.year).toBe('1890');
    expect(renderForeignArticleLookup(input,result)?.status).toBe('valid');
    expect(pages).toEqual([{url:`https://doi.org/${doi}`,accept:'application/x-bibtex'}]);
  });
  for (const [label,page] of [ ['mismatched DOI',bib.replace(doi,'10.1234/wrong')], ['missing DOI',bib.replace(`, doi={${doi}}`,'')], ['non-article record',bib.replace('@article','@book')] ]) {
    it(`rejects ${label}`,async()=>{ const {result,pages}=await run(page); expect(result.articleResolution).not.toBe('resolved'); expect(pages).toHaveLength(1); });
  }
  it('preserves supplied conflicting year',async()=>{ const {result}=await run(bib,`The Right to Privacy (1900), DOI ${doi}`); expect(result.articleResolution).not.toBe('resolved'); expect(result.fields.year).not.toBe('1890'); });
  it('does not resend an unknown page fetch',async()=>{ const {result,pages}=await run(new Error('unknown transport outcome')); expect(result.articleResolution).not.toBe('resolved'); expect(pages).toHaveLength(1); });
});
