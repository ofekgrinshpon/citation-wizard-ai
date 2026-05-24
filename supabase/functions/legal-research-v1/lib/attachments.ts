// Attachments helper for legal-research-v1.
// Downloads user-uploaded PDF/DOCX files from the `user-documents` storage
// bucket and extracts plain text broken into page/chunk units. Used for
// (1) grounding the analyzer prompt with soft context, and
// (2) optionally injecting per-chunk citable "user_document" sources into
// the drafter.

import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.8.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const ATTACHMENT_LIMITS = {
  MAX_FILES: 5,
  MAX_BYTES_PER_FILE: 8 * 1024 * 1024, // 8 MB
  MAX_CHARS_PER_FILE: 12_000,
  MAX_CHARS_TOTAL: 60_000,
  MAX_CHUNKS_PER_FILE: 6,
  CHUNK_CHARS: 1_800,
  PER_FILE_TIMEOUT_MS: 15_000,
  TOTAL_TIMEOUT_MS: 45_000,
  SIGNED_URL_TTL_SEC: 300,
} as const;

export interface AttachmentInput {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size?: number;
}

export interface UserDocChunk {
  /** stable ref like "u1p2" (file 1, page 2) — also drafter ref id */
  ref: string;
  /** human page/chunk number, 1-indexed */
  page: number;
  text: string;
}

export interface UserDocument {
  id: string; // u1, u2, ...
  file_name: string;
  mime_type: string;
  storage_path: string;
  signed_url: string | null;
  chunks: UserDocChunk[];
  total_chars: number;
  truncated: boolean;
  error?: string;
}

export interface AttachmentExtractionResult {
  documents: UserDocument[];
  total_chars: number;
  global_truncated: boolean;
  errors: Array<{ file_name: string; message: string }>;
  ms: number;
}

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function chunkText(raw: string, chunkSize: number, maxChunks: number): string[] {
  const cleaned = raw.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length && chunks.length < maxChunks) {
    // Prefer to break on a paragraph or sentence boundary inside the window.
    let end = Math.min(i + chunkSize, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(i, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
      );
      if (lastBreak > chunkSize * 0.5) end = i + lastBreak + 1;
    }
    chunks.push(cleaned.slice(i, end).trim());
    i = end;
  }
  return chunks.filter((c) => c.length > 0);
}

async function extractPdf(bytes: Uint8Array): Promise<string[]> {
  // unpdf returns either { text: string } or { text: string[] } depending
  // on options. We use mergePages: false to get per-page strings.
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? "")];
  return pages.map((p) => (p ?? "").replace(/\s+\n/g, "\n").trim());
}

async function extractDocx(bytes: Uint8Array): Promise<string[]> {
  const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const text = String(result?.value ?? "");
  // DOCX has no real "pages"; chunk into ~1800-char blocks treated as pages.
  return chunkText(text, ATTACHMENT_LIMITS.CHUNK_CHARS, ATTACHMENT_LIMITS.MAX_CHUNKS_PER_FILE);
}

async function buildSignedUrl(
  admin: SupabaseClient,
  storage_path: string,
): Promise<string | null> {
  try {
    const { data } = await admin
      .storage
      .from("user-documents")
      .createSignedUrl(storage_path, ATTACHMENT_LIMITS.SIGNED_URL_TTL_SEC);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function extractAttachments(
  admin: SupabaseClient,
  userId: string,
  attachments: AttachmentInput[],
): Promise<AttachmentExtractionResult> {
  const t0 = Date.now();
  const documents: UserDocument[] = [];
  const errors: AttachmentExtractionResult["errors"] = [];
  let totalChars = 0;
  let globalTruncated = false;

  const slice = attachments.slice(0, ATTACHMENT_LIMITS.MAX_FILES);
  const userPrefix = `${userId}/research/`;

  for (let idx = 0; idx < slice.length; idx++) {
    if (Date.now() - t0 > ATTACHMENT_LIMITS.TOTAL_TIMEOUT_MS) {
      errors.push({ file_name: slice[idx].file_name, message: "global_timeout" });
      globalTruncated = true;
      break;
    }
    const att = slice[idx];
    const id = `u${idx + 1}`;
    const doc: UserDocument = {
      id,
      file_name: att.file_name,
      mime_type: att.mime_type,
      storage_path: att.storage_path,
      signed_url: null,
      chunks: [],
      total_chars: 0,
      truncated: false,
    };

    if (!ALLOWED_MIME.has(att.mime_type)) {
      doc.error = "unsupported_mime";
      errors.push({ file_name: att.file_name, message: "unsupported_mime" });
      documents.push(doc);
      continue;
    }
    if (!att.storage_path.startsWith(userPrefix)) {
      doc.error = "path_not_owned";
      errors.push({ file_name: att.file_name, message: "path_not_owned" });
      documents.push(doc);
      continue;
    }

    try {
      const { data: blob, error: dlErr } = await admin
        .storage
        .from("user-documents")
        .download(att.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message || "download_failed");
      const arrBuf = await blob.arrayBuffer();
      if (arrBuf.byteLength > ATTACHMENT_LIMITS.MAX_BYTES_PER_FILE) {
        throw new Error(`file_too_large (${arrBuf.byteLength} bytes)`);
      }
      const bytes = new Uint8Array(arrBuf);

      let rawPages: string[];
      if (att.mime_type === "application/pdf") {
        rawPages = await withTimeout(extractPdf(bytes), ATTACHMENT_LIMITS.PER_FILE_TIMEOUT_MS, "pdf");
      } else {
        rawPages = await withTimeout(extractDocx(bytes), ATTACHMENT_LIMITS.PER_FILE_TIMEOUT_MS, "docx");
      }

      // Apply per-file caps.
      let usedChars = 0;
      const remainingGlobal = ATTACHMENT_LIMITS.MAX_CHARS_TOTAL - totalChars;
      for (let p = 0; p < rawPages.length && doc.chunks.length < ATTACHMENT_LIMITS.MAX_CHUNKS_PER_FILE; p++) {
        let pageText = (rawPages[p] || "").trim();
        if (!pageText) continue;

        const fileBudget = ATTACHMENT_LIMITS.MAX_CHARS_PER_FILE - usedChars;
        const globalBudget = remainingGlobal - usedChars;
        const budget = Math.min(fileBudget, globalBudget);
        if (budget <= 50) {
          doc.truncated = true;
          if (globalBudget <= 50) globalTruncated = true;
          break;
        }
        if (pageText.length > budget) {
          pageText = pageText.slice(0, budget) + "…";
          doc.truncated = true;
        }
        doc.chunks.push({
          ref: `${id}p${p + 1}`,
          page: p + 1,
          text: pageText,
        });
        usedChars += pageText.length;
      }
      if (rawPages.length > doc.chunks.length) doc.truncated = true;
      doc.total_chars = usedChars;
      totalChars += usedChars;
      doc.signed_url = await buildSignedUrl(admin, att.storage_path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      doc.error = msg;
      errors.push({ file_name: att.file_name, message: msg });
    }

    documents.push(doc);
  }

  return {
    documents,
    total_chars: totalChars,
    global_truncated: globalTruncated,
    errors,
    ms: Date.now() - t0,
  };
}

/**
 * Builds the short Hebrew context block injected into the analyzer prompt
 * so the model treats attached files as background context, not authority.
 */
export function buildAnalyzerContext(docs: UserDocument[]): string {
  const usable = docs.filter((d) => d.chunks.length > 0);
  if (usable.length === 0) return "";
  const lines: string[] = [];
  lines.push("המשתמש צירף את המסמכים הבאים. השתמש בהם כהקשר עובדתי לפירוק הטענות, אך אל תתייחס אליהם כפסיקה מחייבת או חקיקה ואל תמציא מהם דוקטרינות:");
  for (const d of usable) {
    const head = d.chunks[0]?.text.replace(/\s+/g, " ").slice(0, 240) || "";
    lines.push(`- ${d.file_name} (${d.chunks.length} עמ׳): ${head}${head.length >= 240 ? "…" : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
