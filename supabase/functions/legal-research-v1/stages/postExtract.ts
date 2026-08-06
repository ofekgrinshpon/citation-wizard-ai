// Bounded post-extraction processing.
//
// Why this exists: a Supreme Court archive PDF can extract to >1.1M characters.
// Running cleaning, normalization, identity matching and docket matching over
// that string in one synchronous pass blocks the isolate long enough for the
// edge runtime to kill it — which produced jobs stuck at `running` with the
// last checkpoint `binary_extract_done`.
//
// Everything here is deterministic bookkeeping: chunked passes, explicit
// per-stage character limits, a checkpoint before and after each expensive
// step, and a hard failure (never a hang) when a document is too large to
// process safely.

export type PostExtractSink = (name: string, detail?: Record<string, unknown>) => void;

export const POST_EXTRACT_LIMITS = {
  /** Characters processed per synchronous chunk (event loop yields between). */
  CHUNK_CHARS: 64_000,
  /** Working window kept from the head of a huge extraction. */
  MAX_WORKING_CHARS: 400_000,
  /** Characters fed to the HTML/RTF cleaning regexes. */
  MAX_CLEAN_CHARS: 300_000,
  /** Characters scanned for docket / identity matching. */
  MAX_IDENTITY_CHARS: 40_000,
  /**
   * Absolute ceiling. Beyond this we do not even slice a window — the
   * extraction itself is pathological and the run fails deterministically.
   */
  HARD_MAX_CHARS: 12_000_000,
} as const;

export class PostExtractTooLarge extends Error {
  constructor(public readonly chars: number) {
    super("post_extract_document_too_large");
    this.name = "PostExtractTooLarge";
  }
}

function normChunk(s: string): string {
  return s.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n");
}

function cleanMarkup(s: string): string {
  if (!/<\s*(html|body|p|div|br)\b/i.test(s)) return s;
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

export interface PostExtractOptions {
  onStage?: PostExtractSink;
  /** Consulted between chunks; returning true aborts with `retrieval_timeout`. */
  budgetExceeded?: () => boolean;
  /** Bounded identity/docket predicate, run on the head window only. */
  validateText?: (headWindow: string) => boolean;
  /** When true, a failed identity check throws instead of only marking. */
  identityFatal?: boolean;
}

export interface PostExtractResult {
  text: string;
  truncated: boolean;
  input_chars: number;
  identity_checked: boolean;
  identity_ok: boolean | null;
}

/**
 * Clean → normalize → identity-check an extracted document body under hard
 * limits, yielding to the event loop between chunks so the isolate stays
 * responsive and the budget can actually stop the work.
 */
export async function processExtractedBody(
  raw: string,
  opts: PostExtractOptions = {},
): Promise<PostExtractResult> {
  const onStage = opts.onStage ?? (() => {});
  const gate = (where: string) => {
    if (opts.budgetExceeded?.()) {
      onStage("post_extract_budget_exceeded", { where });
      throw new Error("retrieval_timeout");
    }
  };

  const input = raw || "";
  const inputChars = input.length;
  onStage("post_extract_start", { chars: inputChars });
  if (inputChars > POST_EXTRACT_LIMITS.HARD_MAX_CHARS) {
    onStage("post_extract_too_large", { chars: inputChars });
    throw new PostExtractTooLarge(inputChars);
  }

  const truncated = inputChars > POST_EXTRACT_LIMITS.MAX_WORKING_CHARS;
  const working = truncated ? input.slice(0, POST_EXTRACT_LIMITS.MAX_WORKING_CHARS) : input;

  // ── clean (bounded, chunked) ────────────────────────────────────────────
  gate("before_clean");
  onStage("clean_start", { chars: working.length, truncated });
  const cleanInput = working.length > POST_EXTRACT_LIMITS.MAX_CLEAN_CHARS
    ? working.slice(0, POST_EXTRACT_LIMITS.MAX_CLEAN_CHARS)
    : working;
  const cleanedParts: string[] = [];
  for (let i = 0; i < cleanInput.length; i += POST_EXTRACT_LIMITS.CHUNK_CHARS) {
    gate("clean_chunk");
    cleanedParts.push(cleanMarkup(cleanInput.slice(i, i + POST_EXTRACT_LIMITS.CHUNK_CHARS)));
    await Promise.resolve();
  }
  const cleaned = cleanedParts.join("");
  onStage("clean_done", { chars: cleaned.length });

  // ── normalize (bounded, chunked) ────────────────────────────────────────
  gate("before_normalize");
  onStage("normalize_start", { chars: cleaned.length });
  const normParts: string[] = [];
  for (let i = 0; i < cleaned.length; i += POST_EXTRACT_LIMITS.CHUNK_CHARS) {
    gate("normalize_chunk");
    normParts.push(normChunk(cleaned.slice(i, i + POST_EXTRACT_LIMITS.CHUNK_CHARS)));
    await Promise.resolve();
  }
  const text = normParts.join("").trim();
  onStage("normalize_done", { chars: text.length });

  // ── identity (bounded head window) ──────────────────────────────────────
  let identity_ok: boolean | null = null;
  if (opts.validateText) {
    gate("before_identity");
    onStage("identity_start", { window: Math.min(text.length, POST_EXTRACT_LIMITS.MAX_IDENTITY_CHARS) });
    identity_ok = opts.validateText(text.slice(0, POST_EXTRACT_LIMITS.MAX_IDENTITY_CHARS));
    onStage("identity_done", { ok: identity_ok });
    if (!identity_ok && opts.identityFatal) throw new Error("post_extract_identity_mismatch");
  }

  onStage("post_extract_done", { chars: text.length, truncated });
  return {
    text,
    truncated,
    input_chars: inputChars,
    identity_checked: identity_ok !== null,
    identity_ok,
  };
}
