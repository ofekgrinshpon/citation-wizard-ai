/**
 * v2_raw_web_search_v1 — live validation on the nine batch-2 authorities.
 *
 * Discovery lane only: raw_web_search → candidate → (public GET) body →
 * corroborateAuthority. Nothing here is research policy; it reports whether
 * the new discovery primitive surfaces the correct authority and whether the
 * strengthened identity guard refuses same-digit look-alikes.
 */
import { runRawWebSearch } from "../supabase/functions/legal-research-v2/tools/rawWebSearch.ts";
// primitives → attachments pulls Deno npm: specifiers; unused on this lane.
import { corroborateAuthority } from "../supabase/functions/legal-research-v2/tools/authorityCorroboration.ts";
import { resetResultIds } from "../supabase/functions/legal-research-v2/tools/resultIds.ts";
import { it } from "vitest";

const AUTHORITIES = [
  'ע"א 2553/01',
  'ע"א 3807/12',
  'ע"פ 7293/97',
  'ע"פ 8704/09',
  'ע"א 423/75',
  'ע"א 5185/93',
  'ע"א 4902/91',
  'ע"א 7130/01',
  'ע"א 417/81',
];

const KEY = process.env.PERPLEXITY_API_KEY ?? null;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function body(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "ReLexBot/1.0" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    let text = new TextDecoder("utf-8").decode(buf);
    if ((text.match(/\uFFFD/g)?.length ?? 0) > text.length * 0.01) {
      text = new TextDecoder("windows-1255").decode(buf);
    }
    return /<html/i.test(text) ? stripHtml(text) : text;
  } catch {
    return null;
  }
}

it("raw_web_search live validation", async () => {
const rows: Record<string, unknown>[] = [];

for (const docket of AUTHORITIES) {
  resetResultIds();
  const out = await runRawWebSearch({ query: `${docket} פסק דין מלא`, limit: 8 }, { apiKey: KEY });
  let bound: string | null = null;
  const rejects: { url: string; basis: string }[] = [];
  for (const r of out.results.slice(0, 6)) {
    if (!r.url) continue;
    const text = await body(r.url);
    if (!text || text.length < 1500) continue;
    const c = corroborateAuthority({
      expected: { docket },
      title: r.title,
      text,
      identity_fields: { dockets: [], statutes: [], sections: [], years: [], courts: [] } as never,
      is_actual_document: true,
    });
    if (c.corroborated) {
      bound = r.url;
      break;
    }
    rejects.push({ url: r.url, basis: c.basis });
  }
  rows.push({
    docket,
    error: out.error,
    results: out.results.length,
    domains: [...new Set(out.results.map((r) => r.domain).filter(Boolean))],
    bound,
    rejects,
  });
  console.log(JSON.stringify(rows[rows.length - 1], null, 1));
}

const boundCount = rows.filter((r) => r.bound).length;
console.log(`\nBOUND ${boundCount}/${AUTHORITIES.length}`);
}, 900_000);
