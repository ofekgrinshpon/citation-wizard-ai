#!/usr/bin/env node
/**
 * Distill Israeli legal-academic style guide from the journal_article corpus.
 *
 * Pipeline:
 *   1. Stratified sample of ~150 documents from `legal_documents` where
 *      source_type = 'journal_article'. Stratify by metadata->>'journal'
 *      (fallback metadata->>'publication'); cap 6 per journal.
 *   2. Reassemble content chunks per document_id; slice intro / body / closing.
 *   3. Per-article gpt-5 call (Lovable AI Gateway, reasoning=medium) → 8-dim
 *      structured observation via tool calling.
 *   4. Synthesizer call: gpt-5 (reasoning=high) reads all observations and
 *      emits the Hebrew prescriptive style guide (≤3,000 tokens).
 *
 * Usage:
 *   LOVABLE_API_KEY=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node eval/distill-style-guide.mjs --sample 150 --out eval/style-guide-output
 *
 * Outputs:
 *   <out>/observations-v1.json   — raw per-article structured observations
 *   <out>/draft-style-guide-v1.md — synthesized Hebrew draft for human review
 *
 * After human review, copy the reviewed text into
 *   supabase/functions/legal-qa/academicStyleGuide.ts (ACADEMIC_STYLE_GUIDE)
 * and bump ACADEMIC_STYLE_GUIDE_VERSION.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const SAMPLE_SIZE = Number(args.sample ?? 150);
const OUT_DIR = resolve(args.out ?? "eval/style-guide-output");
const PER_JOURNAL_CAP = 6;

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ─── 1. Fetch journal_article docs ──────────────────────────────────────────
async function pgFetch(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`pg ${r.status}: ${await r.text()}`);
  return r.json();
}

// Direct REST query (avoids needing exec_sql RPC).
async function fetchJournalArticleChunks() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/legal_documents`);
  url.searchParams.set("select", "document_id,content,chunk_index,metadata");
  url.searchParams.set("source_type", "eq.journal_article");
  url.searchParams.set("order", "document_id.asc,chunk_index.asc");
  url.searchParams.set("limit", "50000");
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`fetch chunks: ${r.status} ${await r.text()}`);
  return r.json();
}

console.log("Fetching journal_article chunks…");
const rows = await fetchJournalArticleChunks();
console.log(`Got ${rows.length} chunks`);

// Group by document_id.
const byDoc = new Map();
for (const r of rows) {
  if (!byDoc.has(r.document_id)) byDoc.set(r.document_id, []);
  byDoc.get(r.document_id).push(r);
}

const docs = [];
for (const [docId, chunks] of byDoc.entries()) {
  chunks.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
  const fullContent = chunks.map(c => c.content ?? "").join("\n\n");
  if (fullContent.length < 6000) continue;
  const journal =
    chunks[0]?.metadata?.journal ??
    chunks[0]?.metadata?.publication ??
    "unknown";
  docs.push({ docId, journal, fullContent });
}

// Stratified sample: cap PER_JOURNAL_CAP per journal, shuffle, then take SAMPLE_SIZE.
const buckets = new Map();
for (const d of docs) {
  if (!buckets.has(d.journal)) buckets.set(d.journal, []);
  buckets.get(d.journal).push(d);
}
const sampled = [];
for (const [, arr] of buckets) {
  arr.sort(() => Math.random() - 0.5);
  sampled.push(...arr.slice(0, PER_JOURNAL_CAP));
}
sampled.sort(() => Math.random() - 0.5);
const sample = sampled.slice(0, SAMPLE_SIZE);
console.log(`Stratified sample: ${sample.length} articles across ${buckets.size} journals`);

// ─── 2. Slice each article ──────────────────────────────────────────────────
function sliceArticle(content) {
  const intro = content.slice(0, 2500);
  const mid = Math.max(0, Math.floor(content.length / 2) - 1750);
  const body = content.slice(mid, mid + 3500);
  const closing = content.slice(-1500);
  return { intro, body, closing };
}

// ─── 3. Per-article distillation ────────────────────────────────────────────
const OBSERVATION_TOOL = {
  type: "function",
  function: {
    name: "record_style_observations",
    description: "Record structured style observations across 8 dimensions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "paragraph_rhythm","opening_moves","transitions","counter_argument",
        "footnote_density","closing_moves","register","anti_patterns",
      ],
      properties: {
        paragraph_rhythm: { type: "object", required: ["sentences_per_paragraph_typical","topic_sentence_pattern","notes"], additionalProperties: false, properties: {
          sentences_per_paragraph_typical: { type: "string" },
          topic_sentence_pattern: { type: "string" },
          notes: { type: "string" },
        }},
        opening_moves: { type: "array", items: { type: "string" } },
        transitions: { type: "array", items: { type: "string" } },
        counter_argument: { type: "object", required: ["sequence","example"], additionalProperties: false, properties: {
          sequence: { type: "string" },
          example: { type: "string" },
        }},
        footnote_density: { type: "object", required: ["doctrinal","normative","comparative","summary"], additionalProperties: false, properties: {
          doctrinal: { type: "string" },
          normative: { type: "string" },
          comparative: { type: "string" },
          summary: { type: "string" },
        }},
        closing_moves: { type: "array", items: { type: "string" } },
        register: { type: "object", required: ["preferred","avoid","notes"], additionalProperties: false, properties: {
          preferred: { type: "array", items: { type: "string" } },
          avoid: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        }},
        anti_patterns: { type: "array", items: { type: "string" } },
      },
    },
  },
};

async function callGateway(messages, tools, toolChoice, model = "openai/gpt-5", effort = "medium") {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${LOVABLE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model, messages, tools, tool_choice: toolChoice,
      reasoning: { effort },
    }),
  });
  if (!r.ok) throw new Error(`gateway ${r.status}: ${await r.text()}`);
  return r.json();
}

const distillSystem = `אתה אנליסט סגנון של כתיבה משפטית־אקדמית בעברית. תקבל קטעים מתוך מאמר ב"כתב עת אקדמי משפטי ישראלי. עליך לזקק תצפיות סגנוניות מובנות בשמונה ממדים. אל תחזיר את תוכן המאמר. אל תצטט פראזות שלמות מהמאמר — נסח דפוסים מופשטים. כל שדה חייב להיות תמציתי ומדויק.`;

const observations = [];
for (let i = 0; i < sample.length; i++) {
  const { docId, journal, fullContent } = sample[i];
  const { intro, body, closing } = sliceArticle(fullContent);
  console.log(`[${i+1}/${sample.length}] ${docId} (${journal})`);
  try {
    const resp = await callGateway(
      [
        { role: "system", content: distillSystem },
        { role: "user", content: `כתב עת: ${journal}\n\n=== פתיחה ===\n${intro}\n\n=== גוף ===\n${body}\n\n=== סיום ===\n${closing}` },
      ],
      [OBSERVATION_TOOL],
      { type: "function", function: { name: "record_style_observations" } },
    );
    const tc = resp.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) { console.warn("no tool call"); continue; }
    const obs = JSON.parse(tc.function.arguments);
    observations.push({ docId, journal, ...obs });
  } catch (e) {
    console.warn(`  failed: ${e.message}`);
  }
}

const obsPath = resolve(OUT_DIR, "observations-v1.json");
writeFileSync(obsPath, JSON.stringify(observations, null, 2), "utf8");
console.log(`Wrote ${observations.length} observations → ${obsPath}`);

// ─── 4. Synthesize ──────────────────────────────────────────────────────────
const synthSystem = `אתה עורך סגנון בכיר. תקבל ${observations.length} תצפיות מובנות שזוקקו ממאמרים אקדמיים משפטיים בעברית. עליך לכתוב מסמך הנחיות סגנון יחיד, מקיף, מצרכני (prescriptive), בעברית, באורך עד 12,000 תווים (≈3,000 טוקנים). אסור לך לחרוג מהתקרה. השתמש בכותרות **מודגשות** (לא markdown #). תשעה סעיפים בדיוק:
1. קצב פסקה ומשפט פותח
2. מהלכי פתיחה
3. מהלכי קישור
4. טיפול בטיעוני נגד
5. צפיפות הערות שוליים
6. מהלכי סיום
7. רגיסטר ולשון
8. אנטי־דפוסים — לעולם לא לעשות
9. הקשר משווה — שילוב מונחים ומקורות זרים

כל סעיף יכלול הנחיות ישירות ("אסור / יש / רצוי"), עם דוגמאות פראזות בעברית. אל תכלול הצדקה מטא, אל תכלול אזכורי המקור (התצפיות), אל תצטט מאמרים.`;

const synthResp = await callGateway(
  [
    { role: "system", content: synthSystem },
    { role: "user", content: `התצפיות:\n${JSON.stringify(observations, null, 2)}` },
  ],
  undefined,
  undefined,
  "openai/gpt-5",
  "high",
);
const draftText = synthResp.choices?.[0]?.message?.content ?? "";
const draftPath = resolve(OUT_DIR, "draft-style-guide-v1.md");
writeFileSync(draftPath, draftText, "utf8");
console.log(`Wrote draft style guide (${draftText.length} chars) → ${draftPath}`);
if (draftText.length > 12000) console.warn(`WARNING: draft exceeds 12,000 chars (${draftText.length}); trim before committing.`);
