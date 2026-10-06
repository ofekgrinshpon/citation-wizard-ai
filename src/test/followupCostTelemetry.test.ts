import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as telemetry from '../../supabase/functions/_shared/costTelemetry.ts';
import * as model from '../../supabase/functions/legal-research-v2/shared/model.ts';
import * as router from '../../supabase/functions/legal-research-v2/beta/modelRouter.ts';
import type { CostEvent, CostStage, ParsedUsage } from '../../supabase/functions/_shared/costTelemetry.ts';

const RID = '11111111-1111-4111-8111-111111111111';
const RID2 = '22222222-2222-4222-8222-222222222222';
const BID = '33333333-3333-4333-8333-333333333333';
const PRIVATE = 'PRIVATE_QUESTION_ANSWER_EMAIL_SECRET';
const MODEL = 'openai/gpt-6-sol';
let unexpectedNetwork = 0;
const usage = (extra: Record<string, unknown> = {}) => ({ input_tokens: 1000, output_tokens: 100, total_tokens: 1100,
  input_tokens_details: { cached_tokens: 200 }, output_tokens_details: { reasoning_tokens: 40 }, ...extra });
const parsed = (extra: Record<string, unknown> = {}) => telemetry.parseResponsesUsage({ model: MODEL, usage: usage(extra) });
const price = (u: ParsedUsage = parsed(), m = MODEL, stage: CostStage | undefined = 'v2_direct_chat', ok = true) =>
  telemetry.estimateUsd('lovable_gateway', 'responses', m, u, ok, stage);
const wireBody = (init?: RequestInit): string => {
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
  return init.body;
};
const sse = (m = MODEL, text = PRIVATE, u: Record<string, unknown> | undefined = usage(), type = 'response.completed') => new Response(
  `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n` +
  `data: ${JSON.stringify({ type, response: { id: 'resp_fixture', model: m, ...(u ? { usage: u } : {}) } })}\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
);

beforeEach(() => {
  unexpectedNetwork = 0;
  vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'LOVABLE_API_KEY' ? 'fixture-key-not-real' : undefined } });
  vi.stubGlobal('fetch', () => { unexpectedNetwork++; throw new Error('Unexpected network forbidden'); });
  telemetry.__setDurableWriter(async () => {});
});
afterEach(() => {
  expect(unexpectedNetwork).toBe(0);
  telemetry.__setCostWriter(null); telemetry.__setDurableWriter(null); telemetry.__setRawWriter(null);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function capture<T>(fn: () => Promise<T>, requestId = RID) {
  const rows: CostEvent[] = [];
  let flush = Promise.resolve();
  telemetry.__setCostWriter(async (r) => { rows.push(...r); });
  const result = await telemetry.withCostTelemetry('legal-research-v2', fn, {
    init: { feature: 'legal_research', requestId, batchId: BID }, onFlush: (p) => { flush = p; },
  });
  await flush;
  return { result, rows };
}

describe('follow-up pricing: explicit conservative Standard token scenario', () => {
  it.each([
    ['openai/gpt-6-luna', 'gpt-6-luna', 0.000152],
    ['openai/gpt-6-sol', 'gpt-6-sol', 0.00304],
  ])('prices only the exact configured %s model', (requested, returned, amount) => {
    const p = telemetry.parseResponsesUsage({ model: returned, usage: usage() });
    expect(price(p, requested)).toEqual({ estimated_usd: amount, estimate_complete: false });
  });
  it('does not add reasoning again, and conservatively prices non-read input as write', () => {
    const p = parsed({ input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } });
    expect(price(p).estimated_usd).toBe(0.00304);
    expect(price({ ...p, reasoning_tokens: 100 }).estimated_usd).toBe(0.00304);
  });
  it('all-read and explicit true-zero inputs are valid, but missing usage is unknown', () => {
    expect(price(parsed({ input_tokens_details: { cached_tokens: 1000 } })).estimated_usd).toBe(0.0012);
    expect(price(parsed({ input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } })).estimated_usd).toBe(0);
    expect(price(telemetry.parseResponsesUsage({})).estimated_usd).toBeNull();
  });
  it.each([272000, 272001])('uses total INPUT threshold at %d, not total tokens', (input) => {
    const long = input > 272000;
    const p = parsed({ input_tokens: input, total_tokens: input + 100 });
    const expected = (((input - 200) * 2.5 + 200 * .2) * (long ? 2 : 1) + 100 * 10 * (long ? 1.5 : 1)) / 1e6;
    expect(price(p).estimated_usd).toBeCloseTo(expected, 8);
  });
  it.each(['openai/gpt-6-sol-6.1', 'openai/gpt-6-sol-2026-09-22', 'gpt-6-sol', 'openai/gpt-6-astra', 'constructor', 'toString', '__proto__'])('never invents a price for requested model %s', (m) => {
    expect(price({ ...parsed(), response_model: null }, m).estimated_usd).toBeNull();
  });
  it.each(['openai/gpt-6-luna', 'other-model', 'gpt-6-sol-2026-09-22'])('rejects mismatched returned model %s', (m) => {
    expect(price({ ...parsed(), response_model: m }).estimated_usd).toBeNull();
  });
  it('may use exact requested model if response identity absent, still incomplete', () => {
    expect(price({ ...parsed(), response_model: null })).toEqual({ estimated_usd: .00304, estimate_complete: false });
  });
  it.each(['gpt-6-sol unexpected suffix', 7, { model: MODEL }])('explicit malformed response identity is not treated as absent: %j', (m) => {
    expect(price(telemetry.parseResponsesUsage({ model: m, usage: usage() })).estimated_usd).toBeNull();
    const p = telemetry.parseUsage({ model: m, usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } } });
    expect(price(p).estimated_usd).toBeNull();
  });
  it.each(['v2_research_agent', 'v2_support_verifier', 'formatter', undefined])('does not expand pricing outside follow-ups: %s', (stage) => {
    expect(telemetry.estimateUsd('lovable_gateway', 'responses', MODEL, parsed(), true, stage as CostStage | undefined).estimated_usd).toBeNull();
  });
  it('non-ok attempts retain unknown cost rather than a false zero', () => {
    expect(price(parsed(), MODEL, 'v2_direct_chat', false)).toEqual({ estimated_usd: null, estimate_complete: false });
  });
  it.each([undefined, null, -1, 1.5, '200', Number.NaN, Number.POSITIVE_INFINITY, 1001])('missing/malformed cached read %s never produces a price', (cached) => {
    expect(price(parsed({ input_tokens_details: { cached_tokens: cached } })).estimated_usd).toBeNull();
  });
  it.each([
    { input_tokens: -1 }, { input_tokens: .5 }, { output_tokens: '100' },
    { total_tokens: 999 }, { total_tokens: -1 }, { total_tokens: 1100.5 },
    { output_tokens_details: { reasoning_tokens: -1 } }, { output_tokens_details: { reasoning_tokens: 101 } },
    { input_tokens_details: { cached_tokens: 200, cache_write_tokens: 801 } },
    { input_tokens_details: { cached_tokens: 200, cache_write_tokens: '800' } },
  ])('invalid supplied usage stays unpriced: %j', (u) => {
    expect(price(parsed(u)).estimated_usd).toBeNull();
  });
  it('genuinely absent optional total/reasoning does not become a stored zero', () => {
    const p = parsed({ total_tokens: undefined, output_tokens_details: {} });
    expect(p.total_tokens).toBeNull(); expect(p.reasoning_tokens).toBeNull();
    expect(price(p).estimated_usd).toBe(.00304);
  });
  it('preserves reported USD independently; preferred amount uses nullish precedence, even zero', () => {
    const p = parsed({ cost: { currency: 'USD', total_cost: 0 } });
    const estimate = price(p).estimated_usd;
    expect(p.provider_reported_usd).toBe(0);
    expect(p.provider_reported_usd ?? estimate).toBe(0);
  });
});

describe('actual router/model boundary, zero external calls', () => {
  it('router + direct answer preserve wire shape, replies and model choice', async () => {
    const wires: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      wires.push(wireBody(init));
      const m = JSON.parse(wireBody(init)).model;
      return sse(m, m.endsWith('luna') ? '{"action":"chat","model":"sol","reason":"fixture"}' : PRIVATE);
    });
    const execute = async (r: typeof router) => {
      const route = await r.routeModel({ question: PRIVATE, has_attachments: false, allow_direct: true, conversation_context: PRIVATE });
      const answer = await r.answerDirectChat({ question: PRIVATE, conversation_context: PRIVATE });
      return { action: route.action, model_id: route.model_id, answer: answer.content, ok: answer.ok };
    };
    const { result, rows } = await capture(() => execute(router));
    expect(result).toEqual({ action: 'chat', model_id: MODEL, answer: PRIVATE, ok: true });
    expect(wires).toHaveLength(2);
    for (const wire of wires) {
      expect(Object.keys(JSON.parse(wire)).sort()).toEqual(['input', 'model', 'reasoning', 'store', 'stream']);
      expect(wire).not.toContain('telemetry');
    }
    expect(rows.map(r => r.stage)).toEqual(['v2_router', 'v2_direct_chat']);
    expect(rows.map(r => r.estimated_usd)).toEqual([.000152, .00304]);
    expect(rows.every(r => r.price_version === telemetry.FOLLOWUP_PRICE_VERSION && !r.estimate_complete)).toBe(true);
    expect(rows.every(r => r.telemetry_request_id === RID && r.telemetry_batch_id === BID)).toBe(true);
    expect(rows.every(r => r.latency_complete && r.completion_latency_ms !== null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(PRIVATE);
    expect(JSON.stringify(rows)).not.toContain('fixture-key-not-real');
    expect(JSON.stringify(rows)).not.toContain('messages');
  });
  it('throwing telemetry writers do not change the answer or provider-call count', async () => {
    const fetch = vi.fn(async () => sse()); vi.stubGlobal('fetch', fetch);
    telemetry.__setDurableWriter(async () => { throw new Error('telemetry unavailable'); });
    telemetry.__setCostWriter(async () => { throw new Error('telemetry unavailable'); });
    let flush!: Promise<void>;
    const answer = await telemetry.withCostTelemetry('legal-research-v2', () => router.answerDirectChat({ question: PRIVATE }), { onFlush: p => { flush = p; } });
    expect(answer.ok).toBe(true); expect(answer.content).toBe(PRIVATE);
    await expect(flush).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('the answer does not await database writes', async () => {
    vi.stubGlobal('fetch', async () => sse());
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    let writes = 0;
    telemetry.__setDurableWriter(async () => { writes++; await pending; });
    telemetry.__setCostWriter(async () => { writes++; await pending; });
    let flush!: Promise<void>;
    const answer = await telemetry.withCostTelemetry('legal-research-v2', () => router.answerDirectChat({ question: PRIVATE }), { onFlush: p => { flush = p; } });
    expect(answer.content).toBe(PRIVATE); expect(writes).toBeGreaterThan(0);
    release(); await flush;
  });
  it('concurrent actions preserve correlation and stable per-attempt identities', async () => {
    vi.stubGlobal('fetch', async (_u: unknown, init?: RequestInit) => { await Promise.resolve(); return sse(JSON.parse(wireBody(init)).model); });
    const all: CostEvent[] = [];
    telemetry.__setCostWriter(async rows => { all.push(...rows); });
    const flushes: Promise<void>[] = [];
    await Promise.all([RID, RID2].map(requestId => telemetry.withCostTelemetry('legal-research-v2', () => router.answerDirectChat({ question: PRIVATE }), {
      init: { feature: 'legal_research', requestId, batchId: BID }, onFlush: p => { flushes.push(p); },
    })));
    await Promise.all(flushes);
    expect(all).toHaveLength(2);
    expect(new Set(all.map(r => r.telemetry_request_id))).toEqual(new Set([RID, RID2]));
    expect(new Set(all.map(r => r.id)).size).toBe(2);
    expect(all.map(r => r.attempt_seq)).toEqual([1, 1]);
  });
  it('failed attempt plus retry are two attempts; missing failed usage is not zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('PRIVATE_ERROR', { status: 429 })).mockResolvedValueOnce(sse()));
    const { rows } = await capture(async () => {
      await model.chat({ model: MODEL, messages: [], costStage: 'v2_direct_chat' });
      await model.chat({ model: MODEL, messages: [], costStage: 'v2_direct_chat' });
    });
    expect(rows.map(r => r.outcome)).toEqual(['http_error', 'ok']);
    expect(rows.map(r => r.estimated_usd)).toEqual([null, .00304]);
    expect(rows.map(r => r.attempt_seq)).toEqual([1, 2]);
    expect(new Set(rows.map(r => r.id)).size).toBe(2);
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_ERROR');
  });
  it('incomplete terminal and abort preserve status and do not invent cost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse(MODEL, PRIVATE, usage(), 'response.incomplete'))
      .mockRejectedValueOnce(Object.assign(new Error('PRIVATE_ABORT'), { name: 'AbortError' })));
    const { rows } = await capture(async () => {
      await model.chat({ model: MODEL, messages: [], costStage: 'v2_direct_chat' });
      await model.chat({ model: MODEL, messages: [], costStage: 'v2_direct_chat' });
    });
    expect(rows.map(r => r.outcome)).toEqual(['incomplete', 'aborted']);
    expect(rows.map(r => r.estimated_usd)).toEqual([null, null]);
    expect(rows[0].input_tokens).toBe(1000); expect(rows[1].input_tokens).toBeNull();
  });
  it('durable start/final/flush rows upsert the same attempt rather than double-counting', async () => {
    vi.stubGlobal('fetch', async () => sse());
    const persisted = new Map<string, CostEvent>();
    const writes: Array<{ mode: string; id: string }> = [];
    const write = async (rows: CostEvent[], mode: 'ignore' | 'merge') => { for (const r of rows) {
      writes.push({ mode, id: r.id }); if (mode === 'merge' || !persisted.has(r.id)) persisted.set(r.id, r);
    } };
    telemetry.__setDurableWriter(write);
    telemetry.__setCostWriter(rows => write(rows, 'merge'));
    let flush!: Promise<void>;
    await telemetry.withCostTelemetry('legal-research-v2', () => router.answerDirectChat({ question: PRIVATE }), { onFlush: p => { flush = p; } });
    await flush; await Promise.resolve();
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(writes.map(r => r.id)).size).toBe(1);
    expect(persisted.size).toBe(1); expect([...persisted.values()][0].estimated_usd).toBe(.00304);
  });
});
