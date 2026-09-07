/**
 * legal-research-v2 — append-only, per-run evidence store (in memory).
 *
 * Authoritative answer to exactly one question:
 *   "What did ReLex actually retrieve and read during this run?"
 *
 * Search snippets never enter this store. Only a completed fetch does.
 */

import type { EvidenceSource, IdentityFields } from "../types.ts";
import { detectDockets, detectStatuteSections, sha256Hex } from "../shared/primitives.ts";

export function identityFieldsOf(text: string, title: string): IdentityFields {
  const head = `${title}\n${text.slice(0, 20_000)}`;
  const dockets = detectDockets(head).map((d) => d.number);
  const sections = detectStatuteSections(head);
  return {
    dockets: [...new Set(dockets)],
    statutes: [...new Set(sections.map((s) => s.statute))],
    sections: [...new Set(sections.map((s) => s.section).filter(Boolean) as string[])],
  };
}

export class EvidenceStore {
  private sources = new Map<string, EvidenceSource>();
  private byUrl = new Map<string, string>();
  private seq = 0;

  /** Append a fetched document. Re-fetching the same URL returns the first entry. */
  async append(input: {
    url?: string;
    title: string;
    origin: string;
    fetch_status: "ok" | "error";
    fetch_error?: string;
    extracted_text: string;
    is_actual_document: boolean;
    not_document_reason?: string;
  }): Promise<EvidenceSource> {
    if (input.url) {
      const existing = this.byUrl.get(input.url);
      if (existing) return this.sources.get(existing)!;
    }
    this.seq += 1;
    const source_id = `S${this.seq}`;
    const text = input.extracted_text ?? "";
    const entry: EvidenceSource = {
      source_id,
      url: input.url,
      title: input.title,
      sha256: await sha256Hex(text),
      fetch_status: input.fetch_status,
      fetch_error: input.fetch_error,
      extracted_text: text,
      text_length: text.length,
      identity_fields: identityFieldsOf(text, input.title),
      is_actual_document: input.is_actual_document,
      not_document_reason: input.not_document_reason,
      origin: input.origin,
      fetched_at: new Date().toISOString(),
    };
    this.sources.set(source_id, entry);
    if (input.url) this.byUrl.set(input.url, source_id);
    return entry;
  }

  get(source_id: string): EvidenceSource | null {
    return this.sources.get(source_id) ?? null;
  }

  has(source_id: string): boolean {
    return this.sources.has(source_id);
  }

  all(): EvidenceSource[] {
    return [...this.sources.values()];
  }

  readable(): EvidenceSource[] {
    return this.all().filter((s) => s.fetch_status === "ok" && s.is_actual_document);
  }
}
