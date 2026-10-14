import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { saveCitationHistoryRecord, saveRecoveredCitationHistory } from "@/lib/citationHistorySave";

const h = vi.hoisted(() => ({
  session: vi.fn(), from: vi.fn(), recovery: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: h.session }, from: h.from } }));
vi.mock("@/lib/citationRecoveryApi", () => ({ readCitationRecovery: h.recovery }));

const owner = "owner-account";
const requestId = "original-request-id";
const entry = { user_id: owner, project_id: "project-one", raw_input: "Synthetic source", formatted_output: "Synthetic citation.", source_type: "article" };
const record = () => ({ requestId, retryOfRequestId: null, status: "succeeded", availability: "available",
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
  input: { messages: [{ role: "user", content: "Prepared synthetic prompt" }], rawInput: "Synthetic source", foreignLookup: null, batchId: null },
  result: { content: "Synthetic citation." },
});

type Row = typeof entry & { id: string; citation_request_id?: string };
let rows: Row[];
let loseAck: boolean;
let failInsert: boolean;
let writes: Array<{ method: string; value: Record<string, unknown>; options?: Record<string, unknown> }>;

beforeEach(() => {
  vi.resetAllMocks(); rows = []; writes = []; loseAck = false; failInsert = false;
  h.session.mockResolvedValue({ data: { session: { user: { id: owner } } }, error: null });
  h.recovery.mockResolvedValue(record());
  h.from.mockImplementation((table: string) => {
    expect(table).toBe("citation_history");
    let pending: { method: string; value: Record<string, unknown>; options?: Record<string, unknown> } | null = null;
    const filters: Record<string, string> = {};
    const run = async () => {
      if (pending) {
        writes.push(pending);
        if (failInsert) return { data: null, error: { message: "synthetic write failure" } };
        const duplicate = pending.method === "upsert" && rows.find((row) => row.user_id === pending!.value.user_id && row.citation_request_id === pending!.value.citation_request_id);
        if (duplicate) return { data: null, error: null };
        const added = { ...pending.value, id: `history-${rows.length + 1}` } as Row;
        rows.push(added);
        if (loseAck) { loseAck = false; return { data: null, error: { message: "synthetic lost acknowledgement" } }; }
        return { data: added, error: null };
      }
      const existing = rows.find((row) => Object.entries(filters).every(([key, value]) => row[key as keyof Row] === value));
      return { data: existing ?? null, error: null };
    };
    const chain = {
      insert: (value: Record<string, unknown>) => { pending = { method: "insert", value }; return chain; },
      upsert: (value: Record<string, unknown>, options: Record<string, unknown>) => { pending = { method: "upsert", value, options }; return chain; },
      select: () => chain,
      eq: (key: string, value: string) => { filters[key] = value; return chain; },
      single: run,
      maybeSingle: run,
    };
    return chain;
  });
});

describe("history save identity (synthetic persistence boundary)", () => {
  it("preserves the ordinary insert for free/legacy results", async () => {
    expect(await saveCitationHistoryRecord(entry)).toEqual({ historyId: "history-1", alreadySaved: false });
    expect(writes).toEqual([{ method: "insert", value: entry }]);
    expect(rows[0]).not.toHaveProperty("citation_request_id");
    expect(h.recovery).not.toHaveBeenCalled();
  });

  it("inserts once and returns the original record on repeated saves", async () => {
    const first = await saveCitationHistoryRecord(entry, requestId);
    const repeated = await saveCitationHistoryRecord({ ...entry, formatted_output: "Do not overwrite" }, requestId);
    expect(first).toEqual({ historyId: "history-1", alreadySaved: false });
    expect(repeated).toEqual({ historyId: "history-1", alreadySaved: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].formatted_output).toBe(entry.formatted_output);
    expect(writes[0].options).toEqual({ onConflict: "user_id,citation_request_id", ignoreDuplicates: true });
  });

  it("safe retry after lost acknowledgement does not insert another record", async () => {
    loseAck = true;
    await expect(saveCitationHistoryRecord(entry, requestId)).rejects.toThrow("CITATION_HISTORY_SAVE_FAILED");
    expect(rows).toHaveLength(1);
    expect(await saveCitationHistoryRecord(entry, requestId)).toEqual({ historyId: "history-1", alreadySaved: true });
    expect(rows).toHaveLength(1);
  });

  it("two synthetic concurrent callers converge on one history identity", async () => {
    const results = await Promise.all([saveCitationHistoryRecord(entry, requestId), saveCitationHistoryRecord(entry, requestId)]);
    expect(results.map((result) => result.historyId)).toEqual(["history-1", "history-1"]);
    expect(rows).toHaveLength(1);
  });

  it("does not move an existing saved result into a different project", async () => {
    await saveCitationHistoryRecord(entry, requestId);
    await expect(saveCitationHistoryRecord({ ...entry, project_id: "other-project" }, requestId)).rejects.toThrow("CITATION_HISTORY_DESTINATION_MISMATCH");
    expect(rows[0].project_id).toBe("project-one");
    expect(rows).toHaveLength(1);
  });

  it.each(["other-account", null])("rejects a different current account (%s) before write", async (id) => {
    h.session.mockResolvedValue({ data: { session: id ? { user: { id } } : null }, error: null });
    await expect(saveCitationHistoryRecord(entry, requestId)).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("rejects stale scope before persistence", async () => {
    await expect(saveCitationHistoryRecord(entry, requestId, () => false)).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("does not report success after an account switch during the write", async () => {
    h.session.mockResolvedValueOnce({ data: { session: { user: { id: owner } } }, error: null })
      .mockResolvedValue({ data: { session: { user: { id: "changed-account" } } }, error: null });
    await expect(saveCitationHistoryRecord(entry, requestId)).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(writes[0].value.user_id).toBe(owner);
  });

  it("reports write failure rather than promising saved history", async () => {
    failInsert = true;
    await expect(saveCitationHistoryRecord(entry, requestId)).rejects.toThrow("CITATION_HISTORY_SAVE_FAILED");
    expect(rows).toHaveLength(0);
  });

  it.each(["x", "x".repeat(201)])("rejects an invalid id before writing", async (id) => {
    await expect(saveCitationHistoryRecord(entry, id)).rejects.toThrow("INVALID_REQUEST_ID");
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe("explicit recovered-result save", () => {
  const options = () => ({ requestId, projectId: "project-one", formattedOutput: "Synthetic citation.", expectedAccountId: owner });

  it("refetches the owned current result before independently saving history", async () => {
    expect(await saveRecoveredCitationHistory(options())).toEqual({ historyId: "history-1", alreadySaved: false });
    expect(h.recovery).toHaveBeenCalledWith(owner, requestId, expect.any(Function));
    expect(rows[0]).toMatchObject({ user_id: owner, project_id: "project-one", citation_request_id: requestId, raw_input: "Synthetic source" });
    expect(rows[0]).not.toHaveProperty("is_verified");
  });

  it("joins a normal success save instead of creating a duplicate", async () => {
    await saveCitationHistoryRecord(entry, requestId);
    expect(await saveRecoveredCitationHistory(options())).toEqual({ historyId: "history-1", alreadySaved: true });
    expect(rows).toHaveLength(1);
  });

  it.each(["unknown", "failed", "in_progress"])("does not save a %s request as a success", async (status) => {
    h.recovery.mockResolvedValue({ ...record(), status });
    await expect(saveRecoveredCitationHistory(options())).rejects.toThrow("CITATION_RECOVERY_UNAVAILABLE");
    expect(h.from).not.toHaveBeenCalled();
  });

  it.each([null, { ...record(), availability: "expired" }, { ...record(), result: null },
    { ...record(), input: null }, { ...record(), requestId: "different-request" },
    { ...record(), expiresAt: "invalid" }, { ...record(), expiresAt: "2020-01-01T00:00:00Z" }])("does not save an unavailable or mismatched response", async (value) => {
    h.recovery.mockResolvedValue(value);
    await expect(saveRecoveredCitationHistory(options())).rejects.toThrow("CITATION_RECOVERY_UNAVAILABLE");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("uses retained original prompt when the operation had no separate rawInput", async () => {
    const value = record(); value.input.rawInput = ""; h.recovery.mockResolvedValue(value);
    await saveRecoveredCitationHistory(options());
    expect(rows[0].raw_input).toBe("Prepared synthetic prompt");
  });

  it("preserves original foreign input rather than the constructed prompt", async () => {
    h.recovery.mockResolvedValue({ ...record(), input: { ...record().input, rawInput: null,
      foreignLookup: { rawInput: "Original foreign source" } } });
    await saveRecoveredCitationHistory(options());
    expect(rows[0].raw_input).toBe("Original foreign source");
  });

  it("rejects output that differs from the freshly retrieved result", async () => {
    await expect(saveRecoveredCitationHistory({ ...options(), formattedOutput: "A swapped result" })).rejects.toThrow("CITATION_HISTORY_INVALID_OUTPUT");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("stops if the scope changes while reading the recovery record", async () => {
    let current = true;
    h.recovery.mockImplementation(async () => { current = false; return record(); });
    await expect(saveRecoveredCitationHistory({ ...options(), isResultCurrent: () => current })).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(h.from).not.toHaveBeenCalled();
  });

  it.each([" ", "א".repeat(140000)])("rejects empty or oversized rendered output", async (formattedOutput) => {
    await expect(saveRecoveredCitationHistory({ ...options(), formattedOutput })).rejects.toThrow("CITATION_HISTORY_INVALID_OUTPUT");
    expect(h.recovery).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled();
  });
});

describe("draft history schema preserves existing data", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migration-drafts/20261013163000_citation_recovery_history_identity.sql"), "utf8")
    .replace(/--[^\n]*/g, "");
  it("adds a nullable identity and a durable owner/request unique constraint only", () => {
    expect(sql).toMatch(/ADD COLUMN citation_request_id text/);
    expect(sql).not.toMatch(/citation_request_id text\s+NOT NULL/);
    expect(sql).toMatch(/UNIQUE \(user_id, citation_request_id\)/);
    expect(sql).not.toMatch(/DELETE|UPDATE|DROP|TRUNCATE|REFERENCES|POLICY|GRANT|REVOKE|INTERVAL/i);
  });
});
