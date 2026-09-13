/**
 * legal-research-v2 — local corpus body acquisition (librarian layer).
 *
 * One job: for an authority the AGENT already chose, obtain its stored body
 * from `legal_documents.content` without an HTTP fetch. Nothing here decides
 * WHAT to research, ranks authorities, or makes a source trustworthy: a local
 * row is a candidate like any other and still has to pass the ordinary
 * document check and authority corroboration before it may bind.
 */

import { normalizeDocketText, type SupabaseClient } from "../shared/primitives.ts";

/** How a local row was matched to the requested authority. Telemetry + trust. */
export type LocalMatchBasis = "case_number_exact" | "citation_docket" | "title_ilike";

export interface LocalDocumentRow {
  id: string;
  title: string;
  content: string;
  source_url?: string | null;
  citation?: string | null;
  case_number?: string | null;
}

const DOCKET_RE = /(\d{1,6})[\/\-](\d{1,4})(?:[\/\-](\d{2,4}))?/;

function stripZeros(part: string): string {
  return part.replace(/^0+(?=\d)/, "");
}

/**
 * Equivalent written forms of one docket. Generic string normalization only —
 * no case list, no doctrine knowledge.
 *
 *   `4602/13` / `4602-13` / `בג"ץ 6929-10`  → two-part, canonical slash form
 *   `50358-09-16`                            → three-part, canonical dash form
 */
export function docketVariants(raw: string): { canonical: string | null; variants: string[] } {
  const m = DOCKET_RE.exec(normalizeDocketText(raw ?? ""));
  if (!m) return { canonical: null, variants: [] };
  const parts = [m[1], m[2], m[3]].filter((p): p is string => !!p).map(stripZeros);
  if (parts.length === 3) {
    const dash = parts.join("-");
    return { canonical: dash, variants: [dash, parts.join("/")] };
  }
  const slash = parts.join("/");
  return { canonical: slash, variants: [slash, parts.join("-")] };
}

/** Does this free-text field carry the requested docket in any equivalent form? */
export function textCarriesDocket(text: string | null | undefined, raw: string): boolean {
  const { variants } = docketVariants(raw);
  if (!variants.length) return false;
  const hay = normalizeDocketText(text ?? "");
  return variants.some((v) => hay.includes(v));
}

/** Stable ledger/attempt key for a local acquisition (never an HTTP URL). */
export function localAttemptKey(documentId: string): string {
  return `local:legal_documents/${documentId}`;
}

/**
 * Load one stored body by id. Returns null when the row is missing or the
 * client is unavailable; an empty/unusable body is returned as-is so the
 * caller can fail honestly rather than silently trying something else.
 */
export async function loadLocalDocument(
  admin: SupabaseClient | undefined | null,
  documentId: string,
): Promise<LocalDocumentRow | null> {
  if (!admin || !documentId) return null;
  try {
    const { data } = await admin
      .from("legal_documents")
      .select("id,title,content,source_url,citation,case_number")
      .eq("id", documentId)
      .maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row.id ?? documentId),
      title: String(row.title ?? ""),
      content: typeof row.content === "string" ? row.content : "",
      source_url: (row.source_url as string | null) ?? null,
      citation: (row.citation as string | null) ?? null,
      case_number: (row.case_number as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
