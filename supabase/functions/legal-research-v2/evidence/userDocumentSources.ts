/**
 * legal-research-v2 — preloading user-uploaded documents as evidence sources.
 *
 * Attachments are not a second pipeline: they are read once, before research
 * starts, and appended to the same append-only EvidenceStore every fetched
 * body lands in. From that point on nothing downstream is attachment-aware
 * except provenance (origin = "user_document") and locator formatting.
 */

import type { EvidenceStore } from "./evidenceStore.ts";
import type { EvidenceSource, Intake } from "../types.ts";
import { detectDockets, type SupabaseClient } from "../shared/primitives.ts";
import {
  type AttachmentManifestEntry,
  buildAttachmentManifest,
  type ExtractedUserDocument,
  extractUserDocuments,
} from "../../_shared/userDocuments.ts";

export interface AttachmentTelemetry {
  attachment_count: number;
  attachment_documents_loaded: number;
  attachment_chars_loaded: number;
  attachment_sources_preloaded: string[];
  attachment_extract_errors: Array<{ file_name: string; message: string }>;
  attachment_truncated: boolean;
  attachment_ms: number;
}

export const EMPTY_ATTACHMENT_TELEMETRY: AttachmentTelemetry = {
  attachment_count: 0,
  attachment_documents_loaded: 0,
  attachment_chars_loaded: 0,
  attachment_sources_preloaded: [],
  attachment_extract_errors: [],
  attachment_truncated: false,
  attachment_ms: 0,
};

/** Short deterministic opening excerpt for the agent manifest. */
export function headExcerpt(text: string, max = 260): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function manifestEntryFor(
  source: EvidenceSource,
  doc: { file_name: string; kind: "pdf" | "docx"; pages: unknown[]; truncated: boolean; docket_match: boolean },
): AttachmentManifestEntry {
  return {
    source_id: source.source_id,
    file_name: doc.file_name,
    kind: doc.kind,
    page_count: doc.pages.length,
    head: headExcerpt(source.extracted_text),
    docket_match: doc.docket_match,
    truncated: doc.truncated,
  };
}

/**
 * Append every usable extracted document to the store and return the manifest
 * plus telemetry. A per-file failure is reported, never silently dropped.
 */
export async function preloadExtractedDocuments(
  store: EvidenceStore,
  documents: ExtractedUserDocument[],
  errors: Array<{ file_name: string; message: string }>,
  ms: number,
): Promise<{ manifest: AttachmentManifestEntry[]; telemetry: AttachmentTelemetry }> {
  const manifest: AttachmentManifestEntry[] = [];
  const preloaded: string[] = [];
  let chars = 0;
  let truncated = false;
  const allErrors = [...errors];

  for (const doc of documents) {
    if (doc.error) continue;
    if (!doc.text.trim()) {
      allErrors.push({ file_name: doc.file_name, message: "empty_extraction" });
      continue;
    }
    const source = await store.appendUserDocument({
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      kind: doc.kind,
      storage_path: doc.storage_path,
      text: doc.text,
      pages: doc.pages,
      truncated: doc.truncated,
      docket_match: doc.docket_match,
      matched_dockets: doc.matched_dockets,
    });
    preloaded.push(source.source_id);
    chars += source.text_length;
    truncated = truncated || doc.truncated;
    manifest.push(manifestEntryFor(source, doc));
  }

  return {
    manifest,
    telemetry: {
      attachment_count: documents.length,
      attachment_documents_loaded: preloaded.length,
      attachment_chars_loaded: chars,
      attachment_sources_preloaded: preloaded,
      attachment_extract_errors: allErrors,
      attachment_truncated: truncated,
      attachment_ms: ms,
    },
  };
}

/**
 * Full production path: extract the owned attachments named on the intake and
 * preload them. Mutates `intake.attachment_manifest` so the manifest survives
 * chunk resume with the rest of the intake.
 */
export async function preloadUserDocuments(
  admin: SupabaseClient,
  intake: Intake,
  store: EvidenceStore,
): Promise<AttachmentTelemetry> {
  const attachments = intake.attachments ?? [];
  const ownerId = intake.attachment_owner_id ?? "";
  if (!attachments.length || !ownerId) return EMPTY_ATTACHMENT_TELEMETRY;

  const priority = intake.docket_obligations
    .map((d) => d.display.match(/\d{1,6}\/\d{2}/)?.[0])
    .filter(Boolean) as string[];

  const extraction = await extractUserDocuments(
    admin as unknown as Parameters<typeof extractUserDocuments>[0],
    ownerId,
    attachments,
    { detectDockets, priorityDocketNumbers: priority },
  );
  const { manifest, telemetry } = await preloadExtractedDocuments(
    store,
    extraction.documents,
    extraction.errors,
    extraction.ms,
  );
  intake.attachment_manifest = manifest;
  return { ...telemetry, attachment_count: attachments.length };
}

/** The agent-facing block (empty string when nothing was preloaded). */
export function attachmentContextBlock(intake: Intake): string {
  return buildAttachmentManifest(intake.attachment_manifest ?? []);
}
