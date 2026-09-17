/**
 * Shared, runtime-safe core for user-uploaded research documents.
 *
 * Pure: no network, no storage, no npm/Deno-only imports. Everything here can
 * run inside an edge function AND inside the deterministic test suite.
 *
 * Owns:
 *   - the safety limits (files, bytes, chars, chunks, timeouts);
 *   - attachment metadata validation (mime + path ownership);
 *   - page/chunk assembly with a page map (locator provenance);
 *   - display title / locator formatting for user documents;
 *   - the claim-type rule that keeps a private document from becoming
 *     legal authority.
 */

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

/** A file identified as a judgment for a docket named in the question. */
export const DOCKET_MATCH_LIMITS = {
  MAX_CHARS_PER_FILE: 36_000,
  MAX_CHUNKS_PER_FILE: 12,
  CHUNK_CHARS: 1_800,
} as const;

export const ALLOWED_ATTACHMENT_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export interface AttachmentInput {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size?: number;
}

export interface UserDocPage {
  /** 1-indexed page (PDF) or section (DOCX). */
  page: number;
  text: string;
  /** Offsets inside the assembled document text. */
  start: number;
  end: number;
}

export interface ExtractedUserDocument {
  id: string; // u1, u2, ...
  file_name: string;
  mime_type: string;
  storage_path: string;
  kind: "pdf" | "docx";
  pages: UserDocPage[];
  /** Assembled body text (pages joined) — the only text evidence may quote. */
  text: string;
  total_chars: number;
  truncated: boolean;
  docket_match: boolean;
  matched_dockets: string[];
  error?: string;
}

export interface UserDocExtractionResult {
  documents: ExtractedUserDocument[];
  total_chars: number;
  global_truncated: boolean;
  errors: Array<{ file_name: string; message: string }>;
  ms: number;
}

export type AttachmentRejection =
  | "unsupported_mime"
  | "path_not_owned"
  | "file_too_large"
  | null;

/** Metadata-level validation. Ownership is enforced by the storage path prefix. */
export function validateAttachment(att: AttachmentInput, userId: string): AttachmentRejection {
  if (!ALLOWED_ATTACHMENT_MIME.has(att.mime_type)) return "unsupported_mime";
  if (!att.storage_path || !att.storage_path.startsWith(`${userId}/research/`)) {
    return "path_not_owned";
  }
  if (typeof att.size === "number" && att.size > ATTACHMENT_LIMITS.MAX_BYTES_PER_FILE) {
    return "file_too_large";
  }
  return null;
}

export function attachmentKind(mime: string): "pdf" | "docx" {
  return mime === "application/pdf" ? "pdf" : "docx";
}

/** Split free text into stable, boundary-aware chunks. */
export function chunkText(raw: string, chunkSize: number, maxChunks: number): string[] {
  const cleaned = (raw ?? "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length && chunks.length < maxChunks) {
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

export interface AssembleInput {
  id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  rawPages: string[];
  docket_match: boolean;
  matched_dockets?: string[];
  /** Characters still available across the whole run. */
  remaining_global_chars: number;
}

/**
 * Apply the per-file caps and build the document body with a page map, so a
 * later quote can be attributed to the page/section it came from.
 */
export function assembleUserDocument(input: AssembleInput): ExtractedUserDocument {
  const limits = input.docket_match ? DOCKET_MATCH_LIMITS : ATTACHMENT_LIMITS;
  const pages: UserDocPage[] = [];
  let used = 0;
  let truncated = false;
  let body = "";

  for (let p = 0; p < input.rawPages.length && pages.length < limits.MAX_CHUNKS_PER_FILE; p++) {
    let pageText = (input.rawPages[p] || "").trim();
    if (!pageText) continue;
    const fileBudget = limits.MAX_CHARS_PER_FILE - used;
    const globalBudget = input.remaining_global_chars - used;
    const budget = Math.min(fileBudget, globalBudget);
    if (budget <= 50) {
      truncated = true;
      break;
    }
    if (pageText.length > budget) {
      pageText = pageText.slice(0, budget) + "…";
      truncated = true;
    }
    const start = body.length;
    body += (body ? "\n\n" : "") + pageText;
    pages.push({ page: p + 1, text: pageText, start: start === 0 ? 0 : start + 2, end: body.length });
    used += pageText.length;
  }
  if (input.rawPages.filter((p) => (p || "").trim()).length > pages.length) truncated = true;

  return {
    id: input.id,
    file_name: input.file_name,
    mime_type: input.mime_type,
    storage_path: input.storage_path,
    kind: attachmentKind(input.mime_type),
    pages,
    text: body,
    total_chars: body.length,
    truncated,
    docket_match: input.docket_match,
    matched_dockets: input.matched_dockets ?? [],
  };
}

/** Human display title for an uploaded file — never a storage path. */
export function userDocumentTitle(file_name: string): string {
  const base = (file_name ?? "").split("/").pop() ?? "";
  const noExt = base.replace(/\.(pdf|docx)$/i, "");
  const clean = noExt.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || "מסמך שצורף";
}

/** "הסכם שכירות שצורף" — how a user document is named in a footnote. */
export function userDocumentCitationTitle(file_name: string): string {
  const t = userDocumentTitle(file_name);
  return /שצורף/.test(t) ? t : `${t} שצורף`;
}

/** Page/section locator for a character offset inside the assembled body. */
export function locatorForOffset(
  doc: { kind: "pdf" | "docx"; pages: UserDocPage[] },
  offset: number,
): string | undefined {
  if (offset < 0) return undefined;
  const page = doc.pages.find((p) => offset >= p.start && offset < p.end) ?? doc.pages[0];
  if (!page) return undefined;
  // Word has no true page numbers — never invent them.
  return doc.kind === "pdf" ? `עמ' ${page.page}` : `מקטע ${page.page}`;
}

// ── Claim-type safety ──────────────────────────────────────────────────────

/**
 * Cues that make a proposition a statement about the LAW rather than about
 * the contents of the uploaded document. Deliberately narrow: a private file
 * may prove what it says, never what the law is.
 */
const LEGAL_PROPOSITION_CUES = [
  "הדין בישראל",
  "הדין הישראלי",
  "לפי הדין",
  "על פי הדין",
  "הפסיקה קבעה",
  "בפסיקה נקבע",
  "בית המשפט קבע",
  "בית המשפט העליון",
  "ההלכה",
  "החוק קובע",
  "חוק החוזים",
  "סעיף .* לחוק",
  "תקנה .* לתקנות",
  "מחייב על פי חוק",
  "בטל מעיקרו",
  "ניתן לאכוף לפי",
  "חוקי",
  "בלתי חוקי",
  "תקף משפטית",
];

const DOCUMENT_CONTENT_CUES = [
  "להסכם",
  "בהסכם",
  "בחוזה",
  "לחוזה",
  "במכתב",
  "בכתב התביעה",
  "בכתב ההגנה",
  "במסמך",
  "שצורף",
  "בתצהיר",
];

/**
 * True when the proposition asserts a rule of law (needs real authority), as
 * opposed to reporting what the uploaded document itself says.
 */
export function isLegalPropositionClaim(proposition: string): boolean {
  const p = (proposition ?? "").trim();
  if (!p) return false;
  const legalHit = LEGAL_PROPOSITION_CUES.some((c) => new RegExp(c).test(p));
  if (!legalHit) return false;
  // A pure document-content report that merely mentions a statute name in
  // passing is still document content ("סעיף 7 להסכם מפנה לחוק החוזים").
  const docHit = DOCUMENT_CONTENT_CUES.some((c) => p.includes(c));
  if (!docHit) return true;
  // Mixed phrasing: treat as a legal proposition only when it asserts legality
  // / validity / enforceability rather than content.
  return /(חוקי|בלתי חוקי|תקף|בטל|ניתן לאכוף|אכיפ|לפי הדין|על פי הדין|ההלכה|הפסיקה)/.test(p);
}

/**
 * An uploaded document may serve as legal authority only when its own body
 * corroborates an authority identity the run explicitly asked about.
 * The filename alone never qualifies.
 */
export function userDocumentIsAuthority(
  identity: { dockets: string[]; statutes: string[]; sections: string[] },
  expected: { dockets: string[]; statutes: Array<{ statute: string; section: string | null }> },
): boolean {
  const norm = (s: string) => (s ?? "").replace(/["'״׳\s]/g, "");
  for (const d of expected.dockets) {
    const num = d.match(/\d{1,6}\/\d{2}/)?.[0];
    if (!num) continue;
    if (identity.dockets.some((x) => x.includes(num))) return true;
  }
  for (const st of expected.statutes) {
    if (identity.statutes.some((x) => norm(x).includes(norm(st.statute)))) return true;
  }
  return false;
}

// ── Agent-facing manifest ──────────────────────────────────────────────────

export interface AttachmentManifestEntry {
  source_id: string;
  file_name: string;
  kind: "pdf" | "docx";
  page_count: number;
  head: string;
  docket_match: boolean;
  truncated: boolean;
}

/**
 * The compact block the Research Agent sees. Full bodies stay server-side; the
 * agent reads them with fetch({source_id, ...}) like any other source.
 */
export function buildAttachmentManifest(entries: AttachmentManifestEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.map((e) => {
    const unit = e.kind === "pdf" ? "עמ׳" : "מקטעים";
    const bits = [
      `${e.source_id} — ${e.file_name} — מסמך שצורף על ידי המשתמש — ${e.page_count} ${unit}`,
      e.docket_match ? "(מזוהה כמסמך של תיק שהוזכר בשאלה)" : "",
      e.truncated ? "(נקרא חלקית)" : "",
    ].filter(Boolean).join(" ");
    return `- ${bits}\n  פתיח: ${e.head}`;
  });
  return [
    "מסמכים שצורפו על ידי המשתמש וכבר נקראו ונשמרו כמקורות ראיה. אפשר לקרוא בהם בקריאה ממוקדת: fetch({source_id, find/locator}).",
    ...lines,
    "כללי שימוש: מסמך פרטי שצורף הוא ראיה לתוכנו שלו בלבד (מה כתוב בו), ואינו אסמכתה למצב הדין. טענה משפטית כללית חייבת להישען על חקיקה או פסיקה שהובאו בנפרד. אם המסמך אינו רלוונטי לשאלה — התעלם ממנו; אין חובה לצטט אותו.",
  ].join("\n");
}
