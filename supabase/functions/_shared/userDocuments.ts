// @ts-nocheck
/**
 * Shared user-document extraction (storage + PDF/DOCX).
 *
 * The pure decision logic lives in `userDocumentsCore.ts`; this module only
 * adds the IO: download an OWNED file from the `user-documents` bucket and
 * turn it into page-addressable text under the shared safety limits.
 *
 * Used by legal-research-v2 (production) and available to V1 during rollback.
 */

import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.8.0";

import {
  assembleUserDocument,
  ATTACHMENT_LIMITS,
  type AttachmentInput,
  attachmentKind,
  chunkText,
  type ExtractedUserDocument,
  type UserDocExtractionResult,
  validateAttachment,
} from "./userDocumentsCore.ts";

export * from "./userDocumentsCore.ts";

interface StorageClientLike {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? "")];
  return pages.map((p) => (p ?? "").replace(/\s+\n/g, "\n").trim());
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: copy.buffer });
    return String(result?.value ?? "").replace(/\s+\n/g, "\n").trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/find file in options|arrayBuffer/i.test(msg)) throw e;
    const result = await mammoth.extractRawText({ buffer: copy });
    return String(result?.value ?? "").replace(/\s+\n/g, "\n").trim();
  }
}

export interface ExtractDeps {
  /** Canonical docket detector of the calling runtime. */
  detectDockets?: (text: string) => Array<{ docket_id: string; number: string }>;
  /** Dockets named in the question — these files get the expanded limits. */
  priorityDocketNumbers?: string[];
}

/**
 * Download and extract owned attachments. Per-file failures never abort the
 * batch: each file reports its own error.
 */
export async function extractUserDocuments(
  admin: StorageClientLike,
  userId: string,
  attachments: AttachmentInput[],
  deps: ExtractDeps = {},
): Promise<UserDocExtractionResult> {
  const t0 = Date.now();
  const documents: ExtractedUserDocument[] = [];
  const errors: UserDocExtractionResult["errors"] = [];
  let totalChars = 0;
  let globalTruncated = false;

  const slice = (attachments ?? []).slice(0, ATTACHMENT_LIMITS.MAX_FILES);

  for (let idx = 0; idx < slice.length; idx++) {
    const att = slice[idx];
    const id = `u${idx + 1}`;
    const base: ExtractedUserDocument = {
      id,
      file_name: att.file_name,
      mime_type: att.mime_type,
      storage_path: att.storage_path,
      kind: attachmentKind(att.mime_type),
      pages: [],
      text: "",
      total_chars: 0,
      truncated: false,
      docket_match: false,
      matched_dockets: [],
    };

    if (Date.now() - t0 > ATTACHMENT_LIMITS.TOTAL_TIMEOUT_MS) {
      base.error = "global_timeout";
      errors.push({ file_name: att.file_name, message: "global_timeout" });
      globalTruncated = true;
      documents.push(base);
      continue;
    }

    const rejection = validateAttachment(att, userId);
    if (rejection) {
      base.error = rejection;
      errors.push({ file_name: att.file_name, message: rejection });
      documents.push(base);
      continue;
    }

    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from("user-documents")
        .download(att.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message || "download_failed");
      const arrBuf = await blob.arrayBuffer();
      if (arrBuf.byteLength > ATTACHMENT_LIMITS.MAX_BYTES_PER_FILE) {
        throw new Error(`file_too_large (${arrBuf.byteLength} bytes)`);
      }
      const bytes = new Uint8Array(arrBuf);

      let rawPages: string[];
      if (base.kind === "pdf") {
        rawPages = await withTimeout(
          extractPdfPages(bytes),
          ATTACHMENT_LIMITS.PER_FILE_TIMEOUT_MS,
          "pdf",
        );
      } else {
        const raw = await withTimeout(
          extractDocxText(bytes),
          ATTACHMENT_LIMITS.PER_FILE_TIMEOUT_MS,
          "docx",
        );
        rawPages = chunkText(raw, ATTACHMENT_LIMITS.CHUNK_CHARS, Infinity);
      }

      // Identity hint: does this file carry a docket the question named?
      const priority = deps.priorityDocketNumbers ?? [];
      const detect = deps.detectDockets;
      const probe = `${att.file_name}\n${rawPages.slice(0, 4).join("\n")}`;
      const found = detect ? detect(probe) : [];
      const matched = found
        .filter((d) => priority.some((p) => d.number === p || p.includes(d.number)))
        .map((d) => d.docket_id);
      const docketMatch = matched.length > 0;

      const doc = assembleUserDocument({
        id,
        file_name: att.file_name,
        mime_type: att.mime_type,
        storage_path: att.storage_path,
        rawPages,
        docket_match: docketMatch,
        matched_dockets: [...new Set(matched)],
        remaining_global_chars: ATTACHMENT_LIMITS.MAX_CHARS_TOTAL - totalChars,
      });
      totalChars += doc.total_chars;
      if (doc.truncated) globalTruncated = globalTruncated || false;
      documents.push(doc);
      continue;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      base.error = msg;
      errors.push({ file_name: att.file_name, message: msg });
      documents.push(base);
    }
  }

  return {
    documents,
    total_chars: totalChars,
    global_truncated: globalTruncated,
    errors,
    ms: Date.now() - t0,
  };
}
