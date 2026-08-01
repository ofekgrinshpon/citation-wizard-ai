// Judgment text acquisition for case-law synthesis.
//
// Scope: text acquisition only. This module does NOT change the planner,
// verifier, sufficiency thresholds, drafter prompt/skeleton, footnotes, or any
// deterministic branch. It only tries — in a bounded, deterministic way — to
// obtain real judgment text for a citable judgment candidate that arrived with
// no usable body, so the existing snippet budget has something to spend.
//
// Fail closed: if no usable text is found the source is left exactly as it was
// and the attempt is logged as failed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { Candidate } from "../lib/types.ts";
import { extractDocumentText } from "../lib/attachments.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import { assignSynthesisRole } from "./synthesisRole.ts";

export const ACQUISITION_LIMITS = {
  /** Hard cap on acquisition attempts per answer. */
  MAX_ATTEMPTS: 2,
  /** Per-method time box. */
  PER_METHOD_MS: 7000,
  /** Whole-stage time box. */
  TOTAL_MS: 16000,
  /** Below this many chars the candidate counts as "not enough real text". */
  MIN_USABLE_TEXT: 400,
  /** Never store more than this — the snippet budget caps display anyway. */
  MAX_TEXT: 4000,
  /** Max bytes downloaded per file. */
  MAX_BYTES: 8 * 1024 * 1024,
} as const;

const SYNTHESIS_MODE = "case_law_synthesis";

const ACQUIRABLE_ROLES = new Set([
  "leading_candidate",
  "applying_candidate",
  "limiting_or_distinguishing_candidate",
]);

const ROLE_PRIORITY: Record<string, number> = {
  leading_candidate: 0,
  applying_candidate: 1,
  limiting_or_distinguishing_candidate: 2,
};

const THIN_USABILITY = new Set(["metadata_only", "unusable", "unknown"]);

const FILE_URL_RE = /\.(pdf|docx?|rtf)(\?|#|$)/i;

/** Court download endpoints that serve a file without a file extension. */
const DIRECT_DOWNLOAD_RE = /(\/Home\/Download\?|[?&]fileName=|[?&]download=)/i;

export function isDirectFileUrl(url: string): boolean {
  return FILE_URL_RE.test(url) || DIRECT_DOWNLOAD_RE.test(url);
}

/** Court / official hosts whose HTML pages may wrap a downloadable file. */
export const WRAPPER_HOST_RE = /(court\.gov\.il|gov\.il|nevo\.co\.il|knesset\.gov\.il)/i;

export const HOLDING_TEXT_RE =
  /(אנו\s+פוסקים|הערעור\s+(מתקבל|נדחה)|העתירה\s+(מתקבלת|נדחית)|ניתן\s+היום|אשר\s+על\s+כן|לפיכך\s|נפסק\s+כי|קובע[ת]?\s+כי|הלכה\s+ש|בדעת\s+(רוב|מיעוט)|דעת\s+הרוב)/;

const DOCKET_RE =
  /(בג["״']?ץ|עע["״']?מ|רע["״']?א|רע["״']?פ|ע["״']?א|ע["״']?פ|ע["״']?ע|דנ["״']?א|דנ["״']?פ|בש["״']?פ|ת["״']?א|עה["״']?ס)\s*\d{1,5}\/\d{2,4}/;

export type AcquisitionMethod =
  | "direct_file_fetch"
  | "local_db_docket_lookup"
  | "wrapper_file_resolve";

export interface AcquisitionAttemptLog {
  candidate_id: string;
  title: string;
  url: string | null;
  docket_signal: string | null;
  title_signal: string | null;
  synthesis_role: string;
  trigger_reason: "metadata_only" | "unusable_or_unknown" | "text_below_threshold";
  methods_attempted: AcquisitionMethod[];
  method_succeeded: AcquisitionMethod | null;
  success: boolean;
  extracted_text_length: number;
  text_usability_before: string;
  text_usability_after: string;
  can_support_synthesis_holding: boolean;
  failure_reason: string | null;
  ms: number;
}

export interface AcquisitionResult {
  enabled: boolean;
  mode: string | null;
  eligible_count: number;
  attempts: AcquisitionAttemptLog[];
  attempts_made: number;
  successes: number;
  ms: number;
}

export function normText(s: string): string {
  return (s || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function docketOf(c: Candidate): string | null {
  const hay = `${c.title || ""} ${c.snippet || ""} ${c.source_url || ""}`;
  const m = hay.match(DOCKET_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function availableTextLength(c: Candidate): number {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text : "";
  return Math.max((c.snippet || "").length, ext.length);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error(`${label}_timeout`)), ms) as unknown as number;
      }),
    ]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > ACQUISITION_LIMITS.MAX_BYTES) throw new Error("file_too_large");
  return { bytes: buf, contentType };
}

/** Method 1 — the URL already points at a judgment file. */
export async function tryDirectFile(url: string): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url);
  // Content-type first, then extension, then magic bytes (court download
  // endpoints often serve octet-stream with no extension in the URL).
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4));
  const isPdf =
    /pdf/.test(contentType) || /\.pdf(\?|#|$)/i.test(url) || head.startsWith("%PDF");
  const isDocx =
    /wordprocessingml|msword|officedocument/.test(contentType) ||
    /\.docx?(\?|#|$)/i.test(url) ||
    head.startsWith("PK");
  if (!isPdf && !isDocx) throw new Error("not_a_document_file");
  return normText(await extractDocumentText(bytes, isPdf ? "pdf" : "docx"));
}

/** Method 2 — pull the full text we already store locally, by docket / title. */
export async function tryLocalDb(
  admin: SupabaseClient,
  docket: string | null,
  title: string | null,
): Promise<string> {
  const filters: string[] = [];
  if (docket) {
    const d = docket.replace(/["״']/g, "");
    filters.push(`case_number.ilike.%${d}%`, `citation.ilike.%${d}%`, `title.ilike.%${d}%`);
  }
  if (!filters.length && title) {
    const t = title.replace(/[%,()]/g, " ").trim().slice(0, 60);
    if (t.length < 8) throw new Error("no_docket_or_title_signal");
    filters.push(`title.ilike.%${t}%`);
  }
  if (!filters.length) throw new Error("no_docket_or_title_signal");

  const { data: docs, error } = await admin
    .from("legal_documents")
    .select("id,title")
    .or(filters.join(","))
    .limit(3);
  if (error) throw new Error(`db_error:${error.message}`);
  if (!docs || docs.length === 0) throw new Error("no_local_document_match");

  const { data: chunks, error: cErr } = await admin
    .from("legal_document_chunks")
    .select("content")
    .eq("document_id", docs[0].id)
    .limit(6);
  if (cErr) throw new Error(`db_error:${cErr.message}`);
  const text = normText((chunks ?? []).map((c) => String(c.content ?? "")).join("\n"));
  if (!text) throw new Error("local_document_has_no_chunks");
  return text;
}

/** Method 3 — an HTML wrapper page on a court host that links the real file. */
export async function tryWrapperResolve(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const html = (await res.text()).slice(0, 400_000);
  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1]);
  const fileHref = hrefs.find((h) => FILE_URL_RE.test(h));
  if (!fileHref) throw new Error("no_downloadable_file_on_wrapper");
  const abs = new URL(fileHref, url).toString();
  return await tryDirectFile(abs);
}

export interface AcquisitionInput {
  admin: SupabaseClient;
  research_mode: string | null;
  candidates: Candidate[];
}

/**
 * Bounded judgment-text acquisition. Mutates candidate metadata / integrity in
 * place on success only; returns telemetry for every attempt.
 */
export async function runJudgmentTextAcquisition(
  input: AcquisitionInput,
): Promise<AcquisitionResult> {
  const t0 = Date.now();
  const mode = input.research_mode ?? null;
  if (mode !== SYNTHESIS_MODE) {
    return {
      enabled: false,
      mode,
      eligible_count: 0,
      attempts: [],
      attempts_made: 0,
      successes: 0,
      ms: 0,
    };
  }

  type Eligible = {
    c: Candidate;
    integ: SourceIntegrity;
    role: string;
    trigger: AcquisitionAttemptLog["trigger_reason"];
  };
  const eligible: Eligible[] = [];

  for (const c of input.candidates) {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = meta.source_integrity as SourceIntegrity | undefined;
    if (!integ || integ.citable_as !== "judgment") continue;
    const role = assignSynthesisRole({
      role: c.role,
      integrity: integ,
      title: c.title,
      snippet: c.snippet,
    }).synthesis_role;
    if (!ACQUIRABLE_ROLES.has(role)) continue;

    const usability = String(integ.text_usability ?? "unknown");
    const len = availableTextLength(c);
    let trigger: AcquisitionAttemptLog["trigger_reason"] | null = null;
    if (usability === "metadata_only") trigger = "metadata_only";
    else if (THIN_USABILITY.has(usability)) trigger = "unusable_or_unknown";
    else if (len < ACQUISITION_LIMITS.MIN_USABLE_TEXT) trigger = "text_below_threshold";
    if (!trigger) continue;

    eligible.push({ c, integ, role, trigger });
  }

  eligible.sort(
    (a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9) || b.c.score - a.c.score,
  );

  const attempts: AcquisitionAttemptLog[] = [];
  let successes = 0;

  for (const e of eligible) {
    if (attempts.length >= ACQUISITION_LIMITS.MAX_ATTEMPTS) break;
    if (Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS) break;

    const tAttempt = Date.now();
    const url = e.c.source_url ?? null;
    const docket = docketOf(e.c);
    const methods: AcquisitionMethod[] = [];
    let text = "";
    let succeeded: AcquisitionMethod | null = null;
    let failure: string | null = null;

    const plan: AcquisitionMethod[] = [];
    if (url && isDirectFileUrl(url)) plan.push("direct_file_fetch");
    plan.push("local_db_docket_lookup");
    if (url && WRAPPER_HOST_RE.test(url) && !isDirectFileUrl(url)) {
      plan.push("wrapper_file_resolve");
    }

    for (const method of plan) {
      if (Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS) {
        failure = failure ?? "stage_time_budget_exhausted";
        break;
      }
      methods.push(method);
      try {
        const got = await withTimeout(
          method === "direct_file_fetch"
            ? tryDirectFile(url!)
            : method === "local_db_docket_lookup"
            ? tryLocalDb(input.admin, docket, e.c.title)
            : tryWrapperResolve(url!),
          ACQUISITION_LIMITS.PER_METHOD_MS,
          method,
        );
        if (got.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
          text = got;
          succeeded = method;
          break;
        }
        failure = "extracted_text_below_threshold";
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
    }

    const before = String(e.integ.text_usability ?? "unknown");
    let after = before;
    const holding = !!text && HOLDING_TEXT_RE.test(text);

    if (succeeded && text) {
      const stored = text.slice(0, ACQUISITION_LIMITS.MAX_TEXT);
      after = stored.length >= 1200 ? "full_text" : "substantive_excerpt";
      e.integ.text_usability = after as SourceIntegrity["text_usability"];
      e.integ.has_holding_text = e.integ.has_holding_text || holding;
      e.integ.integrity_flags = [
        ...(e.integ.integrity_flags ?? []),
        "judgment_text_acquired",
      ];
      e.c.metadata = {
        ...(e.c.metadata ?? {}),
        source_integrity: e.integ,
        extended_text: stored,
        judgment_text_acquired: true,
        judgment_text_acquisition_method: succeeded,
      };
      if ((e.c.snippet || "").length < 200) {
        e.c.snippet = stored.slice(0, 600);
      }
      successes++;
    }

    attempts.push({
      candidate_id: e.c.candidate_id,
      title: e.c.title,
      url,
      docket_signal: docket,
      title_signal: e.c.title ? e.c.title.slice(0, 120) : null,
      synthesis_role: e.role,
      trigger_reason: e.trigger,
      methods_attempted: methods,
      method_succeeded: succeeded,
      success: !!succeeded,
      extracted_text_length: text.length,
      text_usability_before: before,
      text_usability_after: after,
      can_support_synthesis_holding:
        !!succeeded && text.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT && holding,
      failure_reason: succeeded ? null : (failure ?? "no_method_available"),
      ms: Date.now() - tAttempt,
    });
  }

  return {
    enabled: true,
    mode,
    eligible_count: eligible.length,
    attempts,
    attempts_made: attempts.length,
    successes,
    ms: Date.now() - t0,
  };
}
