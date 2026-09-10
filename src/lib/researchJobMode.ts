/**
 * Research jobs (answer + source search) share one table, so the UI must be
 * able to tell which workspace intent a job belongs to. The server result
 * carries `output_mode` once the job finishes; while it is still running we
 * rely on a small browser-local map written at submit time.
 */

export type ResearchJobMode = "answer" | "sources";

const STORAGE_KEY = "relex.research.job_modes";
const MAX_ENTRIES = 60;

type JobModeMap = Record<string, ResearchJobMode>;

function readMap(): JobModeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as JobModeMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordResearchJobMode(jobId: string, mode: ResearchJobMode): void {
  if (!jobId) return;
  try {
    const map = readMap();
    map[jobId] = mode;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getRecordedResearchJobMode(jobId: string): ResearchJobMode | null {
  if (!jobId) return null;
  return readMap()[jobId] ?? null;
}

/** Mode implied by a finished job's stored result, when it is knowable. */
export function jobModeFromResult(result: unknown): ResearchJobMode | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.output_mode === "sources" || r.source_pack) return "sources";
  if (r.output_mode === "answer") return "answer";
  if (typeof r.answer === "string" && r.answer.trim() !== "") return "answer";
  return null;
}

/** Result-derived mode first (authoritative), then the local submit hint. */
export function resolveResearchJobMode(
  jobId: string,
  result: unknown,
): ResearchJobMode | null {
  return jobModeFromResult(result) ?? getRecordedResearchJobMode(jobId);
}
