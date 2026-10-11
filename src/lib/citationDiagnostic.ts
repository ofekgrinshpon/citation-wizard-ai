/** Temporary single-fixture console observer; no citation or provider behavior changes. */
import { buildForeignArticleRequest } from "@/lib/foreignArticleAdapter";
import { sanitizeCitationDiagnostic } from "../../supabase/functions/_shared/citationDiagnostic";
import {
  CITATION_DIAGNOSTIC_FIXTURE, CITATION_DIAGNOSTIC_BUILD, CITATION_DIAGNOSTIC_PARSER,
  CITATION_DIAGNOSTIC_QUERY, citationDiagnosticTag,
} from "../../supabase/functions/_shared/citationDiagnosticGate";

export interface CitationDiagnosticActivation { tag: string }
const PHASES = ["ready", "lookup_complete", "lookup_failed", "server_exception"] as const;
let preflight: { tag: string; promise: Promise<boolean>; ready: boolean } | null = null;

function emit(tag: string, value: Record<string, unknown>) {
  try { console.info(`[${tag}] ${JSON.stringify(value)}`); } catch { /* observation never changes answers */ }
}

export function citationDiagnosticCandidate(rawInput: string, isAdmin: boolean, search: string): string | null {
  if (!isAdmin || rawInput.trim() !== CITATION_DIAGNOSTIC_FIXTURE) return null;
  try { return citationDiagnosticTag(new URLSearchParams(search).get(CITATION_DIAGNOSTIC_QUERY)); }
  catch { return null; }
}

export function sanitizeCitationDiagnosticEnvelope(value: unknown, tag: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.tag !== tag || record.version !== 1 || record.build !== CITATION_DIAGNOSTIC_BUILD ||
      record.parser !== CITATION_DIAGNOSTIC_PARSER || !PHASES.includes(record.phase as typeof PHASES[number])) return null;
  const trace = sanitizeCitationDiagnostic(record.trace);
  return { version: 1, tag, build: CITATION_DIAGNOSTIC_BUILD, parser: CITATION_DIAGNOSTIC_PARSER,
    phase: record.phase, ...(trace ? { trace } : {}) };
}

/** A readiness check exits on the server before credits, model or Search calls. */
export function prepareCitationDiagnostic(tag: string): Promise<boolean> {
  if (!citationDiagnosticTag(tag)) return Promise.resolve(false);
  if (preflight?.tag === tag) return preflight.promise;
  const entry = { tag, ready: false, promise: Promise.resolve(false) };
  preflight = entry;
  entry.promise = (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("citation-chat", { body: {
        foreignLookup: buildForeignArticleRequest(CITATION_DIAGNOSTIC_FIXTURE),
        citationDiagnostic: { tag, preflight: true },
      } });
      const envelope = !error && sanitizeCitationDiagnosticEnvelope(data?.citationDiagnostic, tag);
      entry.ready = !!envelope && envelope.phase === "ready";
      emit(tag, entry.ready ? envelope! : { phase: "readiness_failed" });
      return entry.ready;
    } catch { emit(tag, { phase: "readiness_failed" }); return false; }
  })();
  return entry.promise;
}

export function activeCitationDiagnostic(rawInput: string, isAdmin: boolean, search: string): CitationDiagnosticActivation | undefined {
  const tag = citationDiagnosticCandidate(rawInput, isAdmin, search);
  return tag && preflight?.tag === tag && preflight.ready ? { tag } : undefined;
}

export function citationDiagnosticBody(activation: CitationDiagnosticActivation | undefined, rawInput: string) {
  return activation && citationDiagnosticTag(activation.tag) && rawInput.trim() === CITATION_DIAGNOSTIC_FIXTURE
    ? { citationDiagnostic: { tag: activation.tag } } : {};
}

export function observeCitationDiagnostic(
  activation: CitationDiagnosticActivation | undefined, rawInput: string,
  phase: "client_route" | "cache_hit" | "deterministic" | "response" | "client_error",
  details: { articleRoute?: boolean; server?: unknown; httpStatus?: number | null } = {},
) {
  if (!activation || !citationDiagnosticTag(activation.tag) || rawInput.trim() !== CITATION_DIAGNOSTIC_FIXTURE) return;
  const server = sanitizeCitationDiagnosticEnvelope(details.server, activation.tag);
  const status = typeof details.httpStatus === "number" && Number.isInteger(details.httpStatus) &&
    details.httpStatus >= 100 && details.httpStatus <= 599 ? details.httpStatus : null;
  emit(activation.tag, { phase, ...(typeof details.articleRoute === "boolean" ? { articleRoute: details.articleRoute } : {}),
    ...(phase === "response" || phase === "client_error" ? { httpStatus: status, server: server ?? null } : {}) });
}
