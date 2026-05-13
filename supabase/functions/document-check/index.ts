// document-check edge function
// MVP scope: DOCX only, real Word footnotes/endnotes only.
// Actions: create_session | extract_notes | analyze_citations | apply_decisions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractDocxNotes } from "../_shared/docxNotesExtractor.ts";
import {
  CITATION_RULES,
  validateCitation,
  getRequiredFields,
} from "../_shared/citationEngine.ts";
import { CASE_TYPE_PREFIX_RE, CASE_DOCKET_RE } from "../_shared/caseTypePrefixes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const CREDIT_PER_BATCH = 10; // 1 credit per 10 citation candidates (rounded up)

type CitationStatus =
  | "appears_valid"
  | "needs_correction"
  | "missing_info"
  | "unrecognized"
  | "needs_manual_review";

interface CitationItem {
  citation_text: string;
  citation_index_in_note: number;
  detected_source_type: string | null;
  confidence: number;
  status: CitationStatus;
  issues: string[];
  missing_fields: string[];
  suggested_citation: string;
  explanation: string;
  is_repeated_candidate: boolean;
  repeated_reference_to: number | null;
  user_decision: null;
}

interface NoteItem {
  note_id: string;
  note_number: number;
  note_type: "footnote" | "endnote";
  original_note_text: string;
  citations: CitationItem[];
  note_state: "has_citations" | "no_citation_detected";
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status = 400) {
  return jsonResponse({ ok: false, code, message }, status);
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { user: null, supabase: null as ReturnType<typeof createClient> | null };
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, supabase: null };
  return { user: data.user, supabase };
}

const adminClient = () => createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Conservative citation splitting & classification ──────────────────────

function splitCitationsInNote(text: string): string[] {
  // Conservative: split on ; only when both sides look citation-like.
  // Otherwise return the whole note as one candidate.
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const parts = trimmed.split(/\s*;\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return [trimmed];

  // Each part should look at minimum like a citation (contains a digit, comma, or year)
  const looksCitationLike = (s: string) =>
    /\d/.test(s) || /[,()]/.test(s) || /\b(התש|התשע|התשס|התשנ)/.test(s);

  if (parts.every(looksCitationLike)) return parts;
  return [trimmed];
}

const STATUTE_RE = /(חוק|פקודת|פקודה|תקנות|תקנה|חוק-יסוד|חוק יסוד)/;
const COLLECTION_RE = /(ס["״]ח|ק["״]ת|ה["״]ח)/;
const CASE_DB_RE = /\b(נבו|ניתן ב|פורסם בנבו|תקדין|נבו אלקטרוני)\b/i;
const PUBLISHED_VOL_RE = /פ["״]ד/;
const HEBREW_YEAR_RE = /הת(ש|שע|שס|שנ|של|שכ|שי|שט|שח|שז|שו|שה|שד|שג|שב|"|״)/;
const URL_RE = /https?:\/\/\S+/i;
const ARTICLE_RE = /[«"״].+["״»]/;
const REPEATED_RE = /\b(שם|לעיל\s*ה["״]ש)\b/;

function classifyConservatively(
  text: string,
): { sourceType: string | null; confidence: number; explanation: string } {
  const t = text.trim();

  // Strong signal: published case law (פ"ד)
  if (PUBLISHED_VOL_RE.test(t) && CASE_DOCKET_RE.test(t)) {
    return { sourceType: "case_law_published", confidence: 0.85, explanation: "זוהה אזכור פסיקה מדפוס (פ\"ד)." };
  }
  // Case law database (Nevo / Takdin) with case number
  if (CASE_DB_RE.test(t) && CASE_DOCKET_RE.test(t)) {
    return { sourceType: "case_law_database", confidence: 0.75, explanation: "זוהה אזכור פסיקה ממאגר אלקטרוני." };
  }
  // Bare case docket without source — treat as case law (unspecified) but lower confidence
  if (CASE_DOCKET_RE.test(t) && CASE_TYPE_PREFIX_RE.test(t)) {
    return { sourceType: "case_law_database", confidence: 0.55, explanation: "זוהה מספר תיק; סוג הפרסום לא ברור." };
  }
  // Basic Law
  if (/חוק[\s-]?יסוד\s*:/.test(t)) {
    return { sourceType: "basic_law", confidence: 0.85, explanation: "זוהה חוק יסוד." };
  }
  // Primary legislation
  if (STATUTE_RE.test(t) && /חוק/.test(t) && !/תקנות|פקודה|פקודת/.test(t)) {
    return { sourceType: "primary_legislation", confidence: 0.7, explanation: "זוהה חוק ראשי." };
  }
  // Secondary legislation
  if (/תקנות|תקנה/.test(t) || /צו\s/.test(t)) {
    return { sourceType: "secondary_legislation", confidence: 0.65, explanation: "זוהה חקיקת משנה." };
  }
  // Article in periodical
  if (ARTICLE_RE.test(t) && /\b(עמ['׳]|עמ\.|עמוד|\d+)\b/.test(t)) {
    return { sourceType: "journal_article", confidence: 0.55, explanation: "ייתכן מאמר בכתב עת." };
  }
  // Internet source
  if (URL_RE.test(t)) {
    return { sourceType: "internet_source", confidence: 0.5, explanation: "מכיל קישור אינטרנטי." };
  }
  return { sourceType: null, confidence: 0, explanation: "לא זוהה סוג מקור משפטי באופן בטוח." };
}

function extractFieldsForType(
  sourceType: string,
  text: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  // Generic: years
  const hebrewYearMatch = text.match(/הת[ש][א-ת]["״][א-ת](?:[-־]\d{4})?/);
  if (hebrewYearMatch) fields.hebrewYear = hebrewYearMatch[0];
  const gregMatch = text.match(/\b(19|20)\d{2}\b/);
  if (gregMatch) fields.gregorianYear = gregMatch[0];
  // Collection
  const colMatch = text.match(COLLECTION_RE);
  if (colMatch) fields.collection = colMatch[0];
  const pageMatch = text.match(/(?:ס["״]ח|ק["״]ת|ה["״]ח)\s*(\d+)/);
  if (pageMatch) fields.firstPage = pageMatch[1];

  if (sourceType === "case_law_published" || sourceType === "case_law_database") {
    const docket = text.match(CASE_DOCKET_RE);
    if (docket) fields.caseNumber = docket[0];
    const caseType = text.match(CASE_TYPE_PREFIX_RE);
    if (caseType) fields.caseType = caseType[0];
    const parties = text.match(/([\u0590-\u05FFA-Za-z\s'"״׳״.\-]+?)\s+נ['׳]\s+([\u0590-\u05FFA-Za-z\s'"״׳.\-]+?)(?=,|$|\()/);
    if (parties) {
      fields.party1 = parties[1].trim();
      fields.party2 = parties[2].trim();
    }
    if (sourceType === "case_law_published") {
      const volMatch = text.match(/פ["״]ד\s+([א-ת]+)/);
      if (volMatch) fields.volume = volMatch[1];
      fields.series = "פ\"ד";
      const yearInParens = text.match(/\((\d{4})\)/);
      if (yearInParens) fields.year = yearInParens[1];
    }
  }

  if (sourceType === "primary_legislation" || sourceType === "basic_law") {
    const lawNameMatch = text.match(/(חוק[^,]*?)(?=,|התש)/);
    if (lawNameMatch) fields.lawName = lawNameMatch[1].trim();
  }

  if (sourceType === "secondary_legislation") {
    const regMatch = text.match(/(תקנות[^,]*?)(?=,|התש)/);
    if (regMatch) fields.regulationName = regMatch[1].trim();
  }

  return fields;
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  lawName: "שם החוק",
  regulationName: "שם התקנות",
  hebrewYear: "שנה עברית",
  gregorianYear: "שנה לועזית",
  collection: 'קובץ פרסום (ס"ח/ק"ת)',
  firstPage: "עמוד פרסום",
  caseType: "סוג הליך",
  caseNumber: "מספר תיק",
  party1: "שם צד א'",
  party2: "שם צד ב'",
  volume: "כרך",
  series: "סדרה",
  year: "שנה",
};

function buildSuggestedCitation(
  sourceType: string,
  fields: Record<string, string>,
  missing: string[],
): string {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return "";
  let out = ruleSet.template;
  for (const c of ruleSet.components) {
    const value = fields[c.field];
    const placeholder = `[חסר: ${MISSING_FIELD_LABELS[c.field] ?? c.field}]`;
    const replacement = value && value.trim()
      ? value.trim()
      : (missing.includes(c.field) || c.required ? placeholder : "");
    out = out.replace(`{${c.field}}`, replacement);
  }
  // Cleanup: collapse leftover whitespace and dangling separators
  out = out.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/,\s*\./g, ".").trim();
  return out;
}

function analyzeCitation(rawText: string, indexInNote: number): CitationItem {
  const text = rawText.trim();
  const isRepeated = REPEATED_RE.test(text);

  if (isRepeated) {
    return {
      citation_text: text,
      citation_index_in_note: indexInNote,
      detected_source_type: "repeated_reference",
      confidence: 0.8,
      status: "needs_manual_review",
      issues: ["ref_repeated"],
      missing_fields: [],
      suggested_citation: text,
      explanation: 'אזכור חוזר ("שם" / לעיל ה"ש N) — יש לוודא ידנית שהוא מפנה לאזכור המלא הנכון.',
      is_repeated_candidate: true,
      repeated_reference_to: null,
      user_decision: null,
    };
  }

  const { sourceType, confidence, explanation } = classifyConservatively(text);

  if (!sourceType) {
    return {
      citation_text: text,
      citation_index_in_note: indexInNote,
      detected_source_type: null,
      confidence: 0,
      status: "unrecognized",
      issues: [],
      missing_fields: [],
      suggested_citation: "",
      explanation: "הטקסט אינו מזוהה כאזכור משפטי מובנה. ניתן לסווג ידנית אם מדובר באזכור.",
      is_repeated_candidate: false,
      repeated_reference_to: null,
      user_decision: null,
    };
  }

  const fields = extractFieldsForType(sourceType, text);
  const missing = validateCitation(sourceType, fields);

  let status: CitationStatus;
  if (confidence < 0.6) {
    status = "needs_manual_review";
  } else if (missing.length === 0) {
    status = "appears_valid";
  } else if (missing.length >= getRequiredFields(sourceType).length) {
    status = "missing_info";
  } else {
    status = "needs_correction";
  }

  const suggested = buildSuggestedCitation(sourceType, fields, missing);

  return {
    citation_text: text,
    citation_index_in_note: indexInNote,
    detected_source_type: sourceType,
    confidence,
    status,
    issues: missing.length > 0 ? ["missing_required_fields"] : [],
    missing_fields: missing.map((f) => MISSING_FIELD_LABELS[f] ?? f),
    suggested_citation: suggested || text,
    explanation,
    is_repeated_candidate: false,
    repeated_reference_to: null,
    user_decision: null,
  };
}

function summarize(notes: NoteItem[]) {
  let total_citations = 0;
  let appears_valid = 0;
  let needs_correction = 0;
  let missing_info = 0;
  let unrecognized = 0;
  let needs_manual_review = 0;
  let repeated = 0;
  let no_citation_notes = 0;
  for (const n of notes) {
    if (n.note_state === "no_citation_detected") no_citation_notes++;
    for (const c of n.citations) {
      total_citations++;
      switch (c.status) {
        case "appears_valid": appears_valid++; break;
        case "needs_correction": needs_correction++; break;
        case "missing_info": missing_info++; break;
        case "unrecognized": unrecognized++; break;
        case "needs_manual_review": needs_manual_review++; break;
      }
      if (c.is_repeated_candidate) repeated++;
    }
  }
  return {
    notes_count: notes.length,
    citations_count: total_citations,
    appears_valid,
    needs_correction,
    missing_info,
    unrecognized,
    needs_manual_review,
    repeated,
    no_citation_notes,
  };
}

// ─── HTTP handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { user, supabase } = await getAuthedUser(req);
    if (!user || !supabase) return errorResponse("UNAUTHENTICATED", "נדרשת התחברות.", 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return errorResponse("INVALID_BODY", "בקשה לא תקינה.");
    const action = body.action as string;

    const admin = adminClient();

    if (action === "create_session") {
      const { project_id = null } = body;
      const { data, error } = await admin
        .from("document_check_sessions")
        .insert({ user_id: user.id, project_id, status: "draft" })
        .select("id")
        .single();
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      await admin.from("activity_logs").insert({
        user_id: user.id, project_id,
        action: "doc_check.created", details: { session_id: data.id },
      });
      return jsonResponse({ ok: true, session_id: data.id });
    }

    if (action === "extract_notes") {
      const { session_id, file_name, file_base64 } = body;
      if (!session_id || !file_base64) return errorResponse("INVALID_BODY", "חסרים נתונים.");

      // Verify session ownership
      const { data: sess } = await admin
        .from("document_check_sessions")
        .select("id, user_id")
        .eq("id", session_id).single();
      if (!sess || sess.user_id !== user.id) return errorResponse("FORBIDDEN", "אין הרשאה לסשן.", 403);

      // Decode DOCX
      const bin = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
      const max = 25 * 1024 * 1024;
      if (bin.byteLength > max) return errorResponse("FILE_TOO_LARGE", "הקובץ גדול מדי (עד 25MB).");

      // Reject .doc by simple magic-byte check (D0 CF 11 E0 = OLE compound)
      if (bin[0] === 0xd0 && bin[1] === 0xcf && bin[2] === 0x11 && bin[3] === 0xe0) {
        return errorResponse("LEGACY_DOC", 'הקובץ הוא בפורמט .doc הישן. שמרו אותו כ-DOCX מתוך Word ונסו שוב.');
      }

      let result;
      try {
        result = await extractDocxNotes(bin.buffer);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "DOCX_INVALID") return errorResponse("DOCX_INVALID", "הקובץ אינו DOCX תקין.");
        if (msg === "DOCX_NO_DOCUMENT_XML") return errorResponse("DOCX_INVALID", "הקובץ אינו DOCX תקין.");
        throw e;
      }

      if (result.notes.length === 0) {
        await admin.from("document_check_sessions").update({
          status: "failed", file_name: file_name ?? "",
          metadata: { extraction_warnings: result.warnings, no_structured_notes: true },
        }).eq("id", session_id);
        return jsonResponse({
          ok: false,
          code: "NO_STRUCTURED_NOTES",
          message: "לא נמצאו הערות שוליים או הערות סיום מובנות במסמך. ייתכן שההערות הוקלדו ידנית בגוף הטקסט ולא כהערות שוליים של Word. בשלב זה ReLex בודק רק הערות מובנות.",
        });
      }

      // Pre-compute candidate count for cost estimate
      let candidates = 0;
      const notes: NoteItem[] = result.notes.map((n) => {
        const parts = splitCitationsInNote(n.original_note_text);
        const note_state: NoteItem["note_state"] = parts.length === 0 ? "no_citation_detected" : "has_citations";
        candidates += parts.length;
        return {
          ...n,
          citations: [], // populated in analyze step
          note_state,
        };
      });

      const estimated_credits = Math.max(1, Math.ceil(candidates / CREDIT_PER_BATCH));

      await admin.from("document_check_sessions").update({
        status: "extracted",
        file_name: file_name ?? "",
        notes_count: notes.length,
        citations_count: candidates,
        notes,
        metadata: {
          extraction_warnings: result.warnings,
          has_footnotes_part: result.has_footnotes_part,
          has_endnotes_part: result.has_endnotes_part,
          estimated_credits,
        },
      }).eq("id", session_id);

      await admin.from("activity_logs").insert({
        user_id: user.id,
        action: "doc_check.extracted",
        details: { session_id, notes: notes.length, candidates, warnings: result.warnings },
      });

      return jsonResponse({
        ok: true,
        notes_count: notes.length,
        citation_candidates: candidates,
        estimated_credits,
        extraction_warnings: result.warnings,
      });
    }

    if (action === "analyze_citations") {
      const { session_id } = body;
      const { data: sess } = await admin
        .from("document_check_sessions")
        .select("*").eq("id", session_id).single();
      if (!sess || sess.user_id !== user.id) return errorResponse("FORBIDDEN", "אין הרשאה.", 403);
      if (sess.status !== "extracted") return errorResponse("BAD_STATE", "הסשן לא במצב מתאים לבדיקה.");

      const cost = Math.max(1, Math.ceil((sess.citations_count ?? 0) / CREDIT_PER_BATCH));
      const requestId = `doccheck:${session_id}`;
      const { data: consumeRes, error: consumeErr } = await supabase.rpc("consume_credits", {
        _amount: cost, _reason: "document-check analyze", _request_id: requestId,
      });
      if (consumeErr) return errorResponse("CREDITS_ERROR", consumeErr.message, 500);
      const cr = consumeRes as Record<string, unknown>;
      if (!cr.ok) {
        return jsonResponse({ ok: false, code: "INSUFFICIENT_CREDITS", message: "אין מספיק קרדיטים.", required: cr.required, ...cr });
      }

      try {
        const notes: NoteItem[] = (sess.notes as NoteItem[]).map((n) => {
          const parts = splitCitationsInNote(n.original_note_text);
          if (parts.length === 0) {
            return { ...n, note_state: "no_citation_detected", citations: [] };
          }
          return {
            ...n,
            note_state: "has_citations",
            citations: parts.map((p, i) => analyzeCitation(p, i + 1)),
          };
        });

        const summary = summarize(notes);

        await admin.from("document_check_sessions").update({
          status: "review_ready",
          notes,
          summary,
          citations_count: summary.citations_count,
        }).eq("id", session_id);

        await admin.from("activity_logs").insert({
          user_id: user.id,
          action: "doc_check.scanned",
          details: { session_id, ...summary, credits: cost },
        });

        return jsonResponse({ ok: true, summary, notes });
      } catch (e) {
        await supabase.rpc("refund_credits", { _request_id: requestId, _reason: "doc-check failure" });
        return errorResponse("ANALYSIS_FAILED", (e as Error).message, 500);
      }
    }

    if (action === "apply_decisions") {
      const { session_id, decisions } = body;
      if (!session_id || typeof decisions !== "object") return errorResponse("INVALID_BODY", "חסרים נתונים.");
      const { data: sess } = await admin
        .from("document_check_sessions")
        .select("user_id, decisions, notes").eq("id", session_id).single();
      if (!sess || sess.user_id !== user.id) return errorResponse("FORBIDDEN", "אין הרשאה.", 403);
      const merged = { ...(sess.decisions as Record<string, unknown> ?? {}), ...decisions };
      await admin.from("document_check_sessions").update({
        decisions: merged, status: "review_ready",
      }).eq("id", session_id);
      return jsonResponse({ ok: true, decisions: merged });
    }

    if (action === "complete_session") {
      const { session_id } = body;
      const { data: sess } = await admin
        .from("document_check_sessions")
        .select("user_id").eq("id", session_id).single();
      if (!sess || sess.user_id !== user.id) return errorResponse("FORBIDDEN", "אין הרשאה.", 403);
      await admin.from("document_check_sessions").update({ status: "completed" }).eq("id", session_id);
      await admin.from("activity_logs").insert({
        user_id: user.id, action: "doc_check.completed", details: { session_id },
      });
      return jsonResponse({ ok: true });
    }

    return errorResponse("UNKNOWN_ACTION", `Unknown action: ${action}`);
  } catch (e) {
    console.error("document-check error:", e);
    return errorResponse("INTERNAL", (e as Error).message, 500);
  }
});
