// Cost-telemetry attribution ids. Deliberately NOT named batchId/requestId:
// the legacy `batchId` body field switches citation-chat to batch billing
// (consume_usage_batch), so telemetry ids must never be sent under it.

export type CostFeature = "uniform_citation" | "footnotes" | "bibliography";

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
