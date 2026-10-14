import { supabase } from "@/integrations/supabase/client";
import { readCitationRecovery } from "@/lib/citationRecoveryApi";
import { renderCitationRecovery } from "@/lib/renderCitationRecovery";

export interface CitationHistoryInput {
  raw_input: string;
  formatted_output: string;
  source_type: string | null;
  user_id: string | null;
  project_id: string | null;
  is_verified?: boolean;
}

export interface CitationHistorySaveResult {
  historyId: string;
  alreadySaved: boolean;
}

const validRequestId = (value: string) => value.length >= 8 && value.length <= 200;

async function requireCurrentAccount(accountId: string, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) throw new Error("CITATION_HISTORY_STALE");
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== accountId || !isCurrent()) throw new Error("CITATION_HISTORY_STALE");
}

/** Only history persistence. This never runs citation, verification or billing.
 * Legacy/free results keep their ordinary insert behavior; guarded results use
 * a durable owner/request uniqueness key, not a browser-lifetime callback flag. */
export async function saveCitationHistoryRecord(
  entry: CitationHistoryInput,
  requestId?: string,
  isCurrent: () => boolean = () => true,
): Promise<CitationHistorySaveResult> {
  if (!entry.user_id || !isCurrent()) throw new Error("CITATION_HISTORY_STALE");
  const accountId = entry.user_id;
  await requireCurrentAccount(accountId, isCurrent);

  if (!requestId) {
    const { data, error } = await supabase.from("citation_history")
      .insert(entry).select("id").single();
    if (error || !data?.id) throw new Error("CITATION_HISTORY_SAVE_FAILED");
    await requireCurrentAccount(accountId, isCurrent);
    return { historyId: data.id, alreadySaved: false };
  }
  if (!validRequestId(requestId)) throw new Error("INVALID_REQUEST_ID");
  // ON CONFLICT DO NOTHING preserves the original record, including its
  // timestamp, selected project and any later moderation. Never overwrite it.
  const { data, error } = await supabase.from("citation_history")
    .upsert({ ...entry, citation_request_id: requestId }, {
      onConflict: "user_id,citation_request_id", ignoreDuplicates: true,
    }).select("id, project_id").maybeSingle();
  if (error) throw new Error("CITATION_HISTORY_SAVE_FAILED");
  await requireCurrentAccount(accountId, isCurrent);
  if (data?.id) return { historyId: data.id, alreadySaved: false };

  // A lost write acknowledgement is safely retried with the same key. The
  // authenticated owner filter also prevents cross-account identifier probing.
  const { data: existing, error: readError } = await supabase.from("citation_history")
    .select("id, project_id").eq("user_id", accountId)
    .eq("citation_request_id", requestId).maybeSingle();
  await requireCurrentAccount(accountId, isCurrent);
  if (readError || !existing?.id) throw new Error("CITATION_HISTORY_SAVE_UNCONFIRMED");
  if (existing.project_id !== entry.project_id) throw new Error("CITATION_HISTORY_DESTINATION_MISMATCH");
  return { historyId: existing.id, alreadySaved: true };
}

export async function saveRecoveredCitationHistory(options: {
  requestId: string;
  projectId: string | null;
  formattedOutput: string;
  sourceType?: string | null;
  expectedAccountId: string;
  isResultCurrent?: () => boolean;
}): Promise<CitationHistorySaveResult> {
  const isCurrent = options.isResultCurrent ?? (() => true);
  if (!options.formattedOutput.trim() || new TextEncoder().encode(options.formattedOutput).length > 262144) {
    throw new Error("CITATION_HISTORY_INVALID_OUTPUT");
  }
  await requireCurrentAccount(options.expectedAccountId, isCurrent);
  // Refetch instead of trusting a stale view or caller-supplied ownership/state.
  const record = await readCitationRecovery(options.expectedAccountId, options.requestId, isCurrent);
  await requireCurrentAccount(options.expectedAccountId, isCurrent);
  if (!record || record.requestId !== options.requestId || record.status !== "succeeded" ||
      record.availability !== "available" || !record.result || !record.input ||
      !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
    throw new Error("CITATION_RECOVERY_UNAVAILABLE");
  }
  const rendered = renderCitationRecovery(record);
  if (!rendered || rendered.truncated || rendered.formattedOutput !== options.formattedOutput) {
    throw new Error("CITATION_HISTORY_INVALID_OUTPUT");
  }
  const foreignInput = record.input.foreignLookup;
  const rawInput = record.input.rawInput ||
    (typeof foreignInput?.rawInput === "string" ? foreignInput.rawInput : "") ||
    record.input.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n\n");
  if (!rawInput) throw new Error("CITATION_RECOVERY_UNAVAILABLE");
  return saveCitationHistoryRecord({
    raw_input: rawInput,
    formatted_output: options.formattedOutput,
    source_type: rendered.sourceType === "unknown" ? null : rendered.sourceType,
    user_id: options.expectedAccountId,
    project_id: options.projectId,
    // Recovery is not evidence of verification or legal correctness.
  }, record.requestId, isCurrent);
}
