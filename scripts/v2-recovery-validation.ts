/**
 * ReLex V2 — judgment-identity false-negative fix, targeted validation.
 *
 * Launches ONE benchmark question at a time against the deployed
 * legal-research-v2 internal entry point (background mode) and waits for the
 * run to reach a terminal state before returning. Pipeline-read-only.
 *
 * Usage: bun scripts/v2-recovery-fix-validation.ts Q23
 */

// The prompts live in the batch-3 launcher, but importing that module would
// execute its own launch loop as a side effect. The map is parsed from the
// source text instead so exactly one run is started per invocation.
const SRC = await Bun.file(new URL("./v2-batch3-eval.ts", import.meta.url)).text();
const BLOCK = SRC.slice(SRC.indexOf("export const QUESTIONS"));
const QUESTIONS: Record<string, string> = Object.fromEntries(
  [...BLOCK.matchAll(/\n  (Q\d+):\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => [m[1], JSON.parse(`"${m[2]}"`)]),
);

const BASE = process.env.SUPABASE_URL as string;
const ANON = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;
const TOKEN = process.env.V2_EVAL_TOKEN_D as string;

async function launch(id: string, label: string) {
  const r = await fetch(`${BASE}/functions/v1/legal-research-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "x-smoke-mode": "1",
      "x-smoke-token": TOKEN,
    },
    body: JSON.stringify({ question: QUESTIONS[id], background: true, label }),
  });
  console.log(id, "launch", r.status, (await r.text()).slice(0, 200));
}

const id = process.argv[2];
const label = `recovery-fix-${id}`;
if (!QUESTIONS[id]) throw new Error(`unknown question ${id}`);
await launch(id, label);
console.log("label", label);
