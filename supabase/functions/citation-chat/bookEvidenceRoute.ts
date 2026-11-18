import { buildBookEvidencePrompt, BOOK_EVIDENCE_SYSTEM_PROMPT, validateBookModelEvidence, type BookEvidencePacket, type BookEvidenceRecord } from "../_shared/citationPure/bookModelEvidence.ts";
import { chargeModel, markBudgetUnknown, freeformLiveEnabled, FREEFORM_PARSER_MODEL_ID, FREEFORM_GATEWAY_CHAT_URL, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";

export interface BookModelEvidenceEnvelope {
  version: 1;
  records: BookEvidenceRecord[];
  sources: Array<{ id: string; url: string; title?: string; text: string }>;
}
export type BookEvidenceEvaluator = (packet: BookEvidencePacket) => Promise<unknown>;
/** Separate server-only switch; never enabled by a request body or client role claim. */
export function bookEvidenceEnabled(env: Record<string, string | undefined>, now = Date.now()): boolean {
  // Admin-only pilot authorized for this build. The handler still checks the
  // current server role; setting this variable to off rolls it back immediately.
  return now < Date.parse("2026-11-19T12:00:00Z") && (env.BOOK_EVIDENCE_MODEL_LIVE === undefined || env.BOOK_EVIDENCE_MODEL_LIVE === "admin") && freeformLiveEnabled(env);
}
/** One existing gateway call. No tools, retrieval, retry, or user target in prompt. */
export async function evaluateBookEvidence(packet: BookEvidencePacket, deps: {
  apiKey: string; budget: CitationBudget; fetchImpl: typeof fetch;
}): Promise<unknown> {
  const prompt = buildBookEvidencePrompt(packet);
  if (!prompt || packet.sources.reduce((n,s) => n+s.text.length,0) > 16000 || !chargeModel(deps.budget)) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = async () => {
    const response = await deps.fetchImpl(FREEFORM_GATEWAY_CHAT_URL, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: FREEFORM_PARSER_MODEL_ID, temperature: 0, max_tokens: 2400,
        messages: [{role:"system",content:BOOK_EVIDENCE_SYSTEM_PROMPT},{role:"user",content:prompt}] }),
    });
    if (!response.ok) { if (response.status >= 500) markBudgetUnknown(deps.budget); return null; }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder(); let body = "", bytes = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 32768) { markBudgetUnknown(deps.budget); controller.abort(); void reader.cancel().catch(() => {}); return null; }
        body += decoder.decode(next.value, {stream:true});
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const wire = JSON.parse(body);
    if (wire.choices?.[0]?.finish_reason !== "stop") return null;
    const content = wire.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return JSON.parse(content).records ?? null;
  };
  try {
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => {
      markBudgetUnknown(deps.budget); controller.abort(); resolve(null);
    }, 12000); });
    return await Promise.race([call(), timeout]);
  } catch { markBudgetUnknown(deps.budget); return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
/** Validate on original retrieved text; project only short exact quotes to the client. */
export function projectBookEvidence(packet: BookEvidencePacket, proposals: unknown,
  sources: Array<{id:string;url:string;title?:string}>): BookModelEvidenceEnvelope {
  const accepted = validateBookModelEvidence(proposals, packet);
  const empty: BookModelEvidenceEnvelope = {version:1,records:[],sources:[]};
  if (!accepted.records.length || accepted.records.length > 4 || accepted.records.some(r => r.quote.length > 1500)) return empty;
  const records = accepted.records;
  const projected = records.map((r,i) => {
    const source = sources.find(s => s.id === r.sourceId);
    if (!source) return null;
    return { ...source, id: `q${i}`, text: r.quote };
  });
  if (projected.some(s => !s)) return empty;
  return {version:1,records:records.map((r,i)=>({...r,sourceId:`q${i}`})),sources:projected as BookModelEvidenceEnvelope["sources"]};
}
/** Current server-side role check, bounded independently of model time. */
export async function authorizeBookEvidence(check: (signal: AbortSignal) => Promise<boolean>): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([check(controller.signal), new Promise<false>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(false); }, 1500);
    })]) === true;
  } catch { return false; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}


/** Text-only projection, never a browser/parser execution. Binary/PDF payloads
 * and script-heavy unusable pages abstain; the caller keeps its search snippet. */
export function publicBookText(raw: string): string | null {
  if (/^\s*%PDF-|[\x00-\x08\x0E-\x1F]/.test(raw)) return null;
  let text = raw.replace(/<(script|style|head|nav|footer)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<!--[\s\S]*?(?:-->|$)/g," ").replace(/<[^>]*>/g," ")
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_m, hex, dec) => {
      const n = Number.parseInt(hex || dec, hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_m, k) => ({amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "}[k.toLowerCase()] || " "))
    .replace(/\s+/g," ").trim();
  if (text.length < 40 || (text.match(/\p{L}/gu)?.length ?? 0) < text.length / 4) return null;
  return text.slice(0,4000);
}
