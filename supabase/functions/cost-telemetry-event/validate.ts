import {
  sanitizeFeature, sanitizeUuid, zeroWorkEvent,
  ZERO_WORK_LAYERS, type ZeroWorkLayer, type CostEvent,
} from "../_shared/costTelemetry.ts";

const MAX_EVENTS = 20;
const CLIENT_LAYERS: ZeroWorkLayer[] = ["client_verified_store", "local_foreign_formatter", "footnote_import"];

/** Pure validation, exported for tests. Returns null on any invalid entry. */
export function buildClientEvents(body: unknown): CostEvent[] | null {
  if (!body || typeof body !== "object") return null;
  const evs = (body as Record<string, unknown>).events;
  if (!Array.isArray(evs) || evs.length === 0 || evs.length > MAX_EVENTS) return null;
  const out: CostEvent[] = [];
  for (const raw of evs) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    const id = sanitizeUuid(e.id);
    const layer = e.layer as ZeroWorkLayer;
    const kind = e.kind === "deterministic" ? "deterministic" : e.kind === "cache_hit" ? "cache_hit" : null;
    if (!id || !kind || !CLIENT_LAYERS.includes(layer) || !(ZERO_WORK_LAYERS as readonly string[]).includes(layer)) return null;
    out.push(zeroWorkEvent({
      id, functionName: "cost-telemetry-event", feature: sanitizeFeature(e.telemetryFeature),
      requestId: sanitizeUuid(e.telemetryRequestId), batchId: sanitizeUuid(e.telemetryBatchId),
      seq: 1, layer, kind, origin: "client_reported",
    }));
  }
  return out;
}

