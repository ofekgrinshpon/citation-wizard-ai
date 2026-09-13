/**
 * legal-research-v2 — charset-aware text decoding (transport layer only).
 *
 * Israeli court endpoints frequently serve Hebrew as Windows-1255 without a
 * reliable charset declaration. Decoding those bytes as UTF-8 yields a body
 * dominated by U+FFFD while ASCII docket digits survive — long enough to look
 * like a document and to satisfy an ASCII identity check, yet unusable.
 *
 * This module is deterministic and content-agnostic: it decides only WHICH
 * byte decoding produces readable text, never what the text means. It mirrors
 * the proven behaviour of V1's `decodeHebrew()` (replacement-ratio probe, then
 * a windows-1255 retry) and of `vendor/courtEgress.ts`'s `decodeText()`
 * (honour a declared charset), unified into one helper.
 */

/** Ratio of U+FFFD replacement characters in a decoded string. */
export function replacementRatio(text: string): number {
  if (!text) return 0;
  const count = (text.match(/\uFFFD/g) ?? []).length;
  return count / text.length;
}

/** Absolute count of U+FFFD replacement characters. */
export function replacementCount(text: string): number {
  return (text.match(/\uFFFD/g) ?? []).length;
}

/**
 * Conservative decode-corruption signal. Deliberately NOT a language check:
 * an ordinary English document with no Hebrew is perfectly readable.
 */
export const DECODE_QUALITY = {
  /** Below this many replacement characters nothing is ever flagged. */
  MIN_REPLACEMENT_COUNT: 20,
  /** Fraction of the body that must be replacement characters. */
  MAX_REPLACEMENT_RATIO: 0.05,
  /** Sample size for the encoding probe. */
  PROBE_BYTES: 65_536,
} as const;

/** True when the decoded text is dominated by decode corruption. */
export function isUnreadableEncoding(text: string): boolean {
  const count = replacementCount(text);
  if (count < DECODE_QUALITY.MIN_REPLACEMENT_COUNT) return false;
  return replacementRatio(text) >= DECODE_QUALITY.MAX_REPLACEMENT_RATIO;
}

export interface DecodedText {
  text: string;
  /** Charset declared by the response, when present and usable. */
  charset_declared: string | null;
  /** Charset actually used for the returned text. */
  charset_used: string;
  /** Replacement ratio of the plain UTF-8 decoding (before any retry). */
  replacement_ratio_utf8: number;
  /** Replacement ratio of the returned text. */
  replacement_ratio: number;
  /** True when the UTF-8 decoding was rejected in favour of a retry. */
  fallback_applied: boolean;
}

function decodeWith(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function isUtf8Label(label: string): boolean {
  return /^(utf-?8|unicode-1-1-utf-8|us-ascii|ascii|iso-8859-1|latin1)$/i.test(label);
}

/**
 * Decode response bytes to text.
 *
 * 1. A declared, supported, non-UTF-8 charset is honoured verbatim.
 * 2. Otherwise decode as UTF-8.
 * 3. If the UTF-8 decoding looks corrupted, retry as windows-1255 and keep it
 *    only when it is measurably cleaner and yields Hebrew letters.
 */
export function decodeResponseText(bytes: Uint8Array, contentType = ""): DecodedText {
  const headerRaw = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? "")?.[1] ?? null;
  // An HTML body may carry its own declaration when the header carries none;
  // the prologue is ASCII by construction, so a plain latin decode is safe.
  const metaRaw = headerRaw
    ? null
    : /charset\s*=\s*"?([\w-]+)"?/i.exec(
      decodeWith("iso-8859-1", bytes.subarray(0, 4_096)) ?? "",
    )?.[1] ?? null;
  const declaredRaw = headerRaw ?? metaRaw;
  const declared = declaredRaw ? declaredRaw.toLowerCase() : null;

  if (declared && !isUtf8Label(declared)) {
    const decoded = decodeWith(declared, bytes);
    if (decoded !== null) {
      return {
        text: decoded,
        charset_declared: declared,
        charset_used: declared,
        replacement_ratio_utf8: replacementRatio(
          decodeWith("utf-8", bytes.subarray(0, DECODE_QUALITY.PROBE_BYTES)) ?? "",
        ),
        replacement_ratio: replacementRatio(decoded),
        fallback_applied: false,
      };
    }
  }

  const utf8 = decodeWith("utf-8", bytes) ?? "";
  const probe = utf8.slice(0, DECODE_QUALITY.PROBE_BYTES);
  const utf8Ratio = replacementRatio(probe);

  const suspect = declared === null || isUtf8Label(declared)
    ? isUnreadableEncoding(probe) || utf8Ratio >= DECODE_QUALITY.MAX_REPLACEMENT_RATIO
    : false;

  if (suspect) {
    const retry = decodeWith("windows-1255", bytes);
    if (retry !== null) {
      const retryRatio = replacementRatio(retry.slice(0, DECODE_QUALITY.PROBE_BYTES));
      const hasHebrew = /[\u0590-\u05FF]/.test(retry.slice(0, DECODE_QUALITY.PROBE_BYTES));
      if (hasHebrew && retryRatio < utf8Ratio) {
        return {
          text: retry,
          charset_declared: declared,
          charset_used: "windows-1255",
          replacement_ratio_utf8: utf8Ratio,
          replacement_ratio: retryRatio,
          fallback_applied: true,
        };
      }
    }
  }

  return {
    text: utf8,
    charset_declared: declared,
    charset_used: declared && isUtf8Label(declared) ? declared : "utf-8",
    replacement_ratio_utf8: utf8Ratio,
    replacement_ratio: utf8Ratio,
    fallback_applied: false,
  };
}
