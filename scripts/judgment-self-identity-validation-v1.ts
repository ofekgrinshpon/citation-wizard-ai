/**
 * judgment_self_identity_v1 — live validation.
 *
 * Discovery (Perplexity /search, unchanged) → public GET → body-form
 * classification → authority corroboration. Read-only: nothing is ingested,
 * nothing is written, no pipeline run is triggered.
 */
import { corroborateAuthority } from "../supabase/functions/legal-research-v2/tools/authorityCorroboration.ts";
import { classifyLocalCaselawBody } from "../supabase/functions/legal-research-v2/vendor/judgmentBodyForm.ts";

const AUTHORITIES = [
  'ע"א 2553/01',
  'ע"א 3807/12',
  'ע"א 5185/93',
  'ע"א 423/75',
  'ע"א 417/81',
  'ע"פ 8704/09',
];

const KEY = process.env.PERPLEXITY_API_KEY!;

async function search(query: string) {
  const r = await fetch("https://api.perplexity.ai/search", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, max_results: 8 }),
  });
  if (!r.ok) return [] as Array<{ url: string; title: string }>;
  const j = await r.json();
  return (j.results ?? []) as Array<{ url: string; title: string }>;
}

function stripHtml(h: string) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function body(url: string) {
  const r = await fetch(url, {
    headers: { "user-agent": "ReLexBot/1.0", accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(30_000),
  });
  const buf = new Uint8Array(await r.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(buf);
  const bad = (text.match(/\ufffd/g) || []).length;
  if (bad > text.length * 0.01) text = new TextDecoder("windows-1255").decode(buf);
  return stripHtml(text);
}

for (const docket of AUTHORITIES) {
  const results = await search(`${docket} פסק דין מלא`);
  console.log(`\n=== ${docket} ===`);
  let bound = false;
  for (const res of results.slice(0, 6)) {
    let text = "";
    try {
      text = await body(res.url);
    } catch (e) {
      console.log(`  ${res.url}\n    fetch_error: ${String(e).slice(0, 80)}`);
      continue;
    }
    const form = classifyLocalCaselawBody({
      title: res.title ?? "",
      text,
      case_number: null,
      body_chars: text.trim().length,
    });
    const c = corroborateAuthority({
      expected: { docket },
      title: res.title ?? "",
      text,
      identity_fields: { dockets: [], statutes: [], sections: [] },
      is_actual_document: text.trim().length > 400,
    });
    console.log(
      `  ${res.url}\n    chars=${text.length} class=${form.classification} ` +
        `${c.corroborated ? "ACCEPT" : "REJECT"} basis=${c.basis}\n    detail=${c.detail.slice(0, 160)}`,
    );
    if (c.corroborated) bound = true;
  }
  console.log(`  -> ${bound ? "BOUND" : "not bound"}`);
}
