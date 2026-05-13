import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DocCitation {
  citation_text: string;
  citation_index_in_note: number;
  detected_source_type: string | null;
  status: "appears_valid" | "needs_correction" | "missing_info" | "unrecognized" | "needs_manual_review";
  missing_fields: string[];
  suggested_citation: string;
  explanation: string;
  is_repeated_candidate: boolean;
  user_decision: null | { kind: "accept" | "edit" | "ignore"; value?: string };
}
export interface DocNote {
  note_id: string;
  note_number: number;
  note_type: "footnote" | "endnote";
  original_note_text: string;
  citations: DocCitation[];
  note_state: "has_citations" | "no_citation_detected";
}
export interface DocSummary {
  notes_count: number; citations_count: number;
  appears_valid: number; needs_correction: number; missing_info: number;
  unrecognized: number; needs_manual_review: number; repeated: number; no_citation_notes: number;
}

interface State {
  sessionId: string | null;
  notes: DocNote[];
  summary: DocSummary | null;
  decisions: Record<string, DocCitation["user_decision"]>;
  estimatedCredits: number | null;
  notesCount: number;
  candidateCount: number;
  status: "idle" | "extracting" | "awaiting_confirmation" | "analyzing" | "review_ready" | "error";
  error: string | null;
}

const initial: State = {
  sessionId: null, notes: [], summary: null, decisions: {},
  estimatedCredits: null, notesCount: 0, candidateCount: 0, status: "idle", error: null,
};

async function call(action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("document-check", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  return data;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useDocumentCheck() {
  const [state, setState] = useState<State>(initial);

  const reset = useCallback(() => setState(initial), []);

  const upload = useCallback(async (file: File) => {
    setState((s) => ({ ...s, status: "extracting", error: null }));
    try {
      const created = await call("create_session", {});
      if (!created?.ok) throw new Error(created?.message ?? "שגיאה ביצירת סשן.");
      const sessionId = created.session_id as string;
      const file_base64 = await fileToBase64(file);
      const ex = await call("extract_notes", { session_id: sessionId, file_name: file.name, file_base64 });
      if (!ex?.ok) {
        setState((s) => ({ ...s, status: "error", error: ex?.message ?? "שגיאה בחילוץ." }));
        return;
      }
      setState((s) => ({
        ...s, sessionId, status: "awaiting_confirmation",
        notesCount: ex.notes_count, candidateCount: ex.citation_candidates,
        estimatedCredits: ex.estimated_credits,
      }));
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!state.sessionId) return;
    setState((s) => ({ ...s, status: "analyzing", error: null }));
    try {
      const r = await call("analyze_citations", { session_id: state.sessionId });
      if (!r?.ok) {
        setState((s) => ({ ...s, status: "error", error: r?.message ?? "הבדיקה נכשלה." }));
        return;
      }
      setState((s) => ({ ...s, status: "review_ready", notes: r.notes, summary: r.summary }));
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
    }
  }, [state.sessionId]);

  const setDecision = useCallback((noteId: string, citationIdx: number, decision: DocCitation["user_decision"]) => {
    const key = `${noteId}:${citationIdx}`;
    setState((s) => ({ ...s, decisions: { ...s.decisions, [key]: decision } }));
    if (state.sessionId) {
      void call("apply_decisions", { session_id: state.sessionId, decisions: { [key]: decision } });
    }
  }, [state.sessionId]);

  const loadSession = useCallback(async (sessionId: string) => {
    setState((s) => ({ ...s, status: "extracting", error: null }));
    const { data, error } = await supabase
      .from("document_check_sessions")
      .select("id, notes, summary, decisions, notes_count, metadata, status, file_name")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) {
      setState((s) => ({ ...s, status: "error", error: error?.message ?? "הסשן לא נמצא." }));
      return;
    }
    const notes = (data.notes as unknown as DocNote[]) ?? [];
    const summary = (data.summary as unknown as DocSummary) ?? null;
    const decisions = (data.decisions as Record<string, DocCitation["user_decision"]>) ?? {};
    if (data.status === "review_ready" && summary) {
      setState({
        sessionId, notes, summary, decisions,
        estimatedCredits: null,
        notesCount: data.notes_count ?? notes.length,
        candidateCount: notes.reduce((a, n) => a + n.citations.length, 0),
        status: "review_ready", error: null,
      });
    } else {
      setState((s) => ({ ...s, status: "error", error: "הסשן עדיין לא נותח." }));
    }
  }, []);

  return { ...state, upload, analyze, setDecision, reset, loadSession };
}
