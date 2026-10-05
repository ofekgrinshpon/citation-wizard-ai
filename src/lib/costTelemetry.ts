// Cost-telemetry attribution ids. Deliberately NOT named batchId/requestId:
// the legacy `batchId` body field switches citation-chat to batch billing
// (consume_usage_batch), so telemetry ids must never be sent under it.

export type CostFeature = "uniform_citation" | "footnotes" | "bibliography" | "refill";

export interface CostTelemetry {
  feature: CostFeature;
  telemetryBatchId: string;
  telemetryRequestId: string;
}

/** One shared id per user action (e.g. one footnotes run). */
export function newTelemetryBatch(feature: CostFeature): Omit<CostTelemetry, "telemetryRequestId"> {
  return { feature, telemetryBatchId: crypto.randomUUID() };
}

/** One id per source inside an action. */
export function sourceTelemetry(batch: Omit<CostTelemetry, "telemetryRequestId">): CostTelemetry {
  return { ...batch, telemetryRequestId: crypto.randomUUID() };
}

/** Body fields for edge-function calls. Never includes `batchId`. */
export function telemetryBody(t?: CostTelemetry | null): Record<string, string> {
  if (!t) return {};
  return {
    telemetryFeature: t.feature,
    telemetryBatchId: t.telemetryBatchId,
    telemetryRequestId: t.telemetryRequestId,
  };
}

export type ZeroWorkLayer = "client_verified_store" | "local_foreign_formatter" | "footnote_import";

/**
 * Fire-and-forget metadata-only event for zero-provider work (cache /
 * deterministic). Never blocks, never throws, never alters results/billing.
 * Without telemetry the event is skipped (attribution unknown).
 */
export function reportZeroWork(
  t: CostTelemetry | null | undefined,
  layer: ZeroWorkLayer,
  kind: "cache_hit" | "deterministic" = "cache_hit",
): void {
  if (!t) return;
  try {
    const event = { id: crypto.randomUUID(), layer, kind, ...telemetryBody(t) };
    void import("@/integrations/supabase/client")
      .then(({ supabase }) => supabase.functions.invoke("cost-telemetry-event", { body: { events: [event] } }))
      .catch(() => {});
  } catch { /* never affects the UI */ }
}
