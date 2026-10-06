import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BUDGETS, type EvidenceSource, type Footnote, type Intake, type ResearchMemo, type VerificationOutcome } from "../../supabase/functions/legal-research-v2/types";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { EMPTY_ATTACHMENT_TELEMETRY } from "../../supabase/functions/legal-research-v2/evidence/userDocumentSources";
import { newAgentStats, serializeAgentState, deserializeAgentState, type AgentRunResult } from "../../supabase/functions/legal-research-v2/agent/researchAgent";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy";
import { CommitTracker } from "../../supabase/functions/legal-research-v2/agent/commitPolicy";
import { AcquisitionLedger } from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { buildSourcePack, type SourcePack } from "../../supabase/functions/legal-research-v2/sources/sourcePack";
import { RunTimer, resumeGapPhase } from "../../supabase/functions/legal-research-v2/shared/timing";
import { newUsageLedger } from "../../supabase/functions/legal-research-v2/shared/model";
import { isDirectPilotState } from "../../supabase/functions/legal-research-v2/shared/directProviderPolicy";
import { freezeForCheckpoint, isValidMemoReady, MEMO_READY_VERSION, restoreMemoReadyResult } from "../../supabase/functions/legal-research-v2/beta/memoCheckpoint";
import { buildVerificationForensics } from "../../supabase/functions/legal-research-v2/verification/forensics";
import { decideResearchRepair } from "../../supabase/functions/legal-research-v2/verification/repairPolicy";
import { newTemporalCounters } from "../../supabase/functions/legal-research-v2/verification/temporalValidity";
import { annotateProvenance, assessPrimaryGap } from "../../supabase/functions/legal-research-v2/verification/primaryProvenance";
import { assessAnswerCompleteness, PARTIAL_ANSWER_NOTICE } from "../../supabase/functions/legal-research-v2/verification/completeness";
import { gateAnswerBlocks, applyBlockCoverage, wordCount } from "../../supabase/functions/legal-research-v2/drafting/draft";
import { projectVerifiedSynthesis } from "../../supabase/functions/legal-research-v2/drafting/synthesis";
import { isAcademicDeliverable } from "../../supabase/functions/legal-research-v2/drafting/draftingBrief";
import { renderAnswer } from "../../supabase/functions/legal-research-v2/drafting/render";
import { buildAcademicYield } from "../../supabase/functions/legal-research-v2/evidence/academicYield";

// index.ts starts a Deno HTTP server and is not importable in Vitest. Compile
// its complete, verbatim pipeline declaration, including the real checkpoint
// helper and chunk limits. Do not copy/reimplement the source-mode branch or
// downlevel const: the original regression is a temporal-dead-zone error.
const filename = "supabase/functions/legal-research-v2/index.ts";
const source = readFileSync(resolve(__dirname, "../..", filename), "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const declarations = ["runPipeline", "saveMemoReadyCheckpoint", "CHUNK"].map((name) => {
  const node = ast.statements.find((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === name)));
  if (!node) throw new Error(`Missing pipeline declaration: ${name}`);
  return node.getText(ast);
});
const compiled = ts.transpileModule(declarations.join("\n") + "\nexports.runPipeline = runPipeline;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Keep fixture types local: importing the Deno HTTP entrypoint even for a type
// would pull its URL imports into the frontend TypeScript project.
type PipelineResume = {
  agent_state: ReturnType<typeof serializeAgentState>;
  usage: ReturnType<typeof newUsageLedger>;
  started_at: number;
  chunk_index: number;
  pipeline_phase?: "memo_ready";
  pipeline_phase_version?: typeof MEMO_READY_VERSION;
  pause_kind?: "handoff" | "checkpoint";
};

type PipelineResult = {
  ok: boolean;
  paused?: boolean;
  resume?: PipelineResume;
  awaiting_user?: { question: string };
  output_mode?: string;
  source_pack: SourcePack;
  answer_markdown: string;
  footnotes: Footnote[];
  invariant_errors: string[];
  telemetry: Record<string, unknown>;
};
type PipelineOptions = { chunked?: boolean; resume?: PipelineResume };
type RunPipeline = (admin: unknown, intake: Intake, opts: PipelineOptions) => Promise<PipelineResult>;

const question = "Synthetic local evidence";
const quote = "Synthetic local evidence supports this fixture.";
const uploadedFile = { storage_path: "test/fixture.pdf", file_name: "fixture.pdf", mime_type: "application/pdf" };

function fixture({ memo = true, attachment = false }: { memo?: boolean; attachment?: boolean } = {}) {
  const row: EvidenceSource = {
    source_id: "S1", title: "Synthetic local fixture", origin: attachment ? "user_document" : "web",
    sha256: "synthetic", extracted_text: quote, text_length: quote.length, fetched_at: "2026-01-01T00:00:00Z",
    fetch_status: "ok", is_actual_document: true,
    identity_fields: { dockets: [], statutes: [], sections: [] },
  };
  const rows = memo || attachment ? [row] : [];
  const store = EvidenceStore.fromJSON({ seq: rows.length, sources: rows });
  const researchMemo: ResearchMemo = {
    issue_summary: question, research_complete: true, unresolved_questions: [],
    claims: [{ claim_id: "c1", importance: "core", proposition: quote, evidence: [{ source_id: row.source_id, quoted_span: quote, reason: "Fixture relevance" }] }],
    answer_blocks: [{ type: "paragraph", text: quote, claim_ids: ["c1"] }],
  };
  const agent: AgentRunResult = {
    memo: memo ? researchMemo : null, paused: false, trace: [], messages: [], discovered: new Map(),
    policy: new StopPolicy(DEFAULT_BUDGETS), commit: new CommitTracker(), ledger: new AcquisitionLedger(), stats: newAgentStats(),
  };
  const verification: VerificationOutcome = {
    pack: { claims: [{ claim_id: "c1", proposition: quote, importance: "core", support_status: "supported", sources: [{ source_id: row.source_id, display_title: row.title, verified_span: quote, support: "supports" }] }], unsupported_claims: [] },
    per_source: { S1: { readable: true, identity: true, span: true, support: true } },
    rejected: [], counters: { total_evidence_pairs: 1, identity_verified_pairs: 1, span_verified_pairs: 1, support_verdicts: { supports: 1, supports_partially: 0, does_not_support: 0 } },
  };
  const intake: Intake = {
    run_id: "synthetic-local-only", question, normalized_question: question,
    output_mode: "sources", attachments: attachment ? [uploadedFile] : [],
    attachment_owner_id: attachment ? "synthetic-user" : null,
    docket_obligations: [], statute_obligations: [], attachment_text: null, budgets: { ...DEFAULT_BUDGETS },
  };
  const preload = vi.fn(async () => ({
    ...EMPTY_ATTACHMENT_TELEMETRY,
    attachment_count: 1, attachment_documents_loaded: 1,
    attachment_chars_loaded: quote.length, attachment_sources_preloaded: [row.source_id],
  }));
  const research = vi.fn(async () => agent);
  const verify = vi.fn(async () => verification);
  const sourceRenderer = vi.fn(buildSourcePack);
  const answerRenderer = vi.fn(renderAnswer);
  const drafter = vi.fn(() => { throw new Error("Unexpected separate drafter call"); });
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const admin = { from: vi.fn(() => ({ update })) };
  const context = createContext({
    exports: {}, console, Date, performance,
    Deno: { env: { get: () => undefined } },
    // Acquisition/model/database I/O is mocked; deterministic packing,
    // rendering, telemetry and checkpoint serialization use production code.
    EvidenceStore: function () { return store; },
    preloadUserDocuments: preload, runResearchAgent: research, verifyMemo: verify,
    modelConfig: () => ({ agent: "fixture", verifier: "fixture", drafter: "fixture" }),
    newUsageLedger, isDirectPilotState, EMPTY_ATTACHMENT_TELEMETRY, RunTimer, resumeGapPhase,
    resetEgressStateForRun: vi.fn(), runtimeDiagnosticsActive: () => false,
    serializeAgentState, deserializeAgentState, freezeForCheckpoint,
    isValidMemoReady, restoreMemoReadyResult, MEMO_READY_VERSION,
    decideResearchRepair, buildVerificationForensics, buildSourcePack: sourceRenderer,
    renderAnswer: answerRenderer, runDrafter: drafter,
    // Answer-mode control: only model verdicts are stubbed. Real gates and the
    // renderer must still produce the cited upload and its attachment telemetry.
    newTemporalCounters,
    assessTemporalValidity: vi.fn(async () => ({ counters: newTemporalCounters(), assessments: [] })),
    assessPrimaryGap, annotateProvenance, projectVerifiedSynthesis, isAcademicDeliverable,
    gateAnswerBlocks, applyBlockCoverage, agentAnswerWordCount: wordCount,
    checkAnswerBlockCoverage: vi.fn(async () => ({ verdicts: [{ block_index: 0, coverage: "covered", reason: "Fixture verdict" }], checked: 1 })),
    assessAnswerCompleteness, PARTIAL_ANSWER_NOTICE, buildAcademicYield, egressTelemetry: () => ({}),
  });
  runInContext(compiled, context, { filename, timeout: 2000 });
  const pipeline = (context.exports as { runPipeline: RunPipeline }).runPipeline;
  return {
    agent, intake, store, researchMemo, verification, preload, research, verify, sourceRenderer, answerRenderer, drafter, update,
    run: (opts: PipelineOptions = { chunked: true }) => pipeline(admin, intake, opts),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network access is forbidden in pipeline fixtures"); }));
});
afterEach(() => vi.unstubAllGlobals());

function expectSourcesCompleted(result: PipelineResult, recommended: number) {
  expect(result).toMatchObject({ ok: true, output_mode: "sources", answer_markdown: "", footnotes: [], invariant_errors: [] });
  expect(result.paused).toBeUndefined();
  expect(result.source_pack.recommended).toHaveLength(recommended);
  expect(result.telemetry).toMatchObject({
    output_mode: "sources", recommended_source_count: recommended,
    drafter_invoked: false, attachment_sources_cited: [],
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

describe("source-mode pipeline finalization", () => {
  it.each([false, true])("completes with zero attachments (verified memo: %s)", async (memo) => {
    const f = fixture({ memo });
    const result = await f.run();
    expectSourcesCompleted(result, memo ? 1 : 0);
    expect(result.telemetry).toMatchObject({
      attachment_count: 0, attachment_documents_loaded: 0, attachment_chars_loaded: 0,
      attachment_sources_preloaded: [], attachment_extract_errors: [],
    });
    expect(f.preload).not.toHaveBeenCalled();
    expect(f.verify).toHaveBeenCalledTimes(memo ? 1 : 0);
    expect(f.sourceRenderer).toHaveBeenCalledOnce();
    expect(f.answerRenderer).not.toHaveBeenCalled();
    expect(f.drafter).not.toHaveBeenCalled();
    if (memo) expect(result.source_pack.recommended[0]).toMatchObject({ source_id: "S1", excerpt: quote, span_verified: true });
  });

  it("reports a loaded, recommended upload without claiming an answer citation", async () => {
    const f = fixture({ attachment: true });
    const result = await f.run();
    expectSourcesCompleted(result, 1);
    expect(result.source_pack.recommended[0].source_id).toBe("S1");
    expect(result.telemetry).toMatchObject({
      attachment_count: 1, attachment_documents_loaded: 1, attachment_chars_loaded: quote.length,
      attachment_sources_preloaded: ["S1"], attachment_extract_errors: [], attachment_authority_rejections: 0,
      identity_verified_pairs: 1, span_verified_pairs: 1,
    });
    expect(f.preload).toHaveBeenCalledOnce();
    expect(f.answerRenderer).not.toHaveBeenCalled();
    expect(f.drafter).not.toHaveBeenCalled();
  });

  it.each(["chunk", "clarification"] as const)("preserves a %s pause and finalizes after resuming without reloading uploads", async (pause) => {
    const f = fixture({ memo: false, attachment: true });
    f.agent.paused = true;
    if (pause === "clarification") f.agent.awaiting_user = { question: "Which synthetic issue?" };
    const paused = await f.run();
    expect(paused).toMatchObject({ ok: true, paused: true, resume: { chunk_index: 1 } });
    expect(paused.telemetry).toBeUndefined();
    expect(f.sourceRenderer).not.toHaveBeenCalled();
    expect(f.verify).not.toHaveBeenCalled();
    if (pause === "clarification") expect(paused.awaiting_user).toEqual(f.agent.awaiting_user);
    else expect(paused.resume?.pause_kind).toBe("handoff");

    f.agent.paused = false;
    delete f.agent.awaiting_user;
    f.agent.memo = f.researchMemo;
    const resumed = await f.run({ chunked: true, resume: paused.resume });
    expectSourcesCompleted(resumed, 1);
    expect(resumed.telemetry).toMatchObject({ chunks_executed: 2, attachment_count: 1, attachment_documents_loaded: 1, attachment_sources_preloaded: ["S1"] });
    expect(f.preload).toHaveBeenCalledOnce();
    expect(f.research).toHaveBeenCalledTimes(2);
    expect(f.verify).toHaveBeenCalledOnce();
    expect(f.answerRenderer).not.toHaveBeenCalled();
  });

  it("finalizes a memo-ready resume without repeating the research call", async () => {
    const f = fixture({ attachment: true });
    const resume: PipelineResume = {
      agent_state: serializeAgentState({ result: f.agent, store: f.store }),
      chunk_index: 1, usage: newUsageLedger(), started_at: Date.now(),
      pipeline_phase: "memo_ready", pipeline_phase_version: MEMO_READY_VERSION,
    };
    const result = await f.run({ chunked: true, resume });
    expectSourcesCompleted(result, 1);
    expect(result.telemetry).toMatchObject({ chunks_executed: 2, attachment_count: 1, attachment_documents_loaded: 1, attachment_sources_preloaded: ["S1"] });
    expect(f.research).not.toHaveBeenCalled();
    expect(f.preload).not.toHaveBeenCalled();
    expect(f.verify).toHaveBeenCalledOnce();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.answerRenderer).not.toHaveBeenCalled();
  });

  it("keeps answer-mode upload citations and deterministic rendering", async () => {
    const f = fixture({ attachment: true });
    f.intake.output_mode = "answer";
    f.intake.agent_authored_answer = true;
    const result = await f.run();
    expect(result.ok).toBe(true);
    expect(result.paused).toBeUndefined();
    expect(result.answer_markdown).toContain(quote);
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0].sources.map((s) => s.source_id)).toEqual(["S1"]);
    expect(result.invariant_errors).toEqual([]);
    expect(result.telemetry).toMatchObject({ attachment_sources_cited: ["S1"], cited_source_count: 1, footnote_count: 1, separate_drafter_called: false });
    expect(f.answerRenderer).toHaveBeenCalledOnce();
    expect(f.sourceRenderer).not.toHaveBeenCalled();
    expect(f.drafter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
