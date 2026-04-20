/**
 * Heuristic validator for the אזכור אחיד (single citation / freetext) input.
 * Used to prevent charging credits on gibberish or empty input,
 * and to detect AI refusal responses so the credit can be refunded.
 *
 * Pure, dependency-free, safe to mirror in Deno edge functions.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  messageHe?: string;
}

const HEBREW_LETTER = /[\u0590-\u05FF]/;
const URL_RE = /https?:\/\/\S+/i;

// Common Israeli case-law abbreviations (1–3 Hebrew letters + gershayim).
const LEGAL_ABBR_RE =
  /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|דנ["״]פ|ת["״]א|ת["״]פ|תפ["״]ח|ע["״]ע|עע["״]מ|בש["״]פ|בש["״]א|עמ["״]ה|בר["״]ם|פ["״]ד|ס["״]ח|ק["״]ת|ה["״]ח|י["״]פ|כ["״]א)/;

const LEGAL_KEYWORD_RE =
  /(?:^|\s)(?:חוק|חוק[- ]?יסוד|פקודת|פקודה|תקנות|תקנה|צו|כללי|הוראות|סעיף|הצעת\s+חוק|אמנה|תקנון|פסק[- ]?דין|פס["״]ד|בית[- ]?המשפט|השופט[ת]?|הנשיא[ה]?|נגד|נ['׳])/;

const CASE_NUMBER_RE = /\b\d+\/\d{2,4}\b/;
const PARTY_SEPARATOR_RE = /\sנ['׳]\s|\sנגד\s/;

// Pure single-character/short-pattern repetition: "עעעע", "aaaa", "1111", "abcabcabc".
const SINGLE_CHAR_REPEAT_RE = /^(.)\1{2,}$/;
const SHORT_PATTERN_REPEAT_RE = /^(.{1,3})\1{2,}$/;

const LATIN_OR_DIGIT_ONLY_RE = /^[a-z0-9\s.,!?-]+$/i;

const INVALID_MESSAGE_HE =
  "לא ניתן לעבד את הבקשה כי לא זוהה טקסט משפטי ברור לאזכור.";

/**
 * Validate a single-citation freetext input. Returns valid:false for inputs
 * that should NOT trigger a paid action.
 */
export function validateCitationInput(raw: string): ValidationResult {
  const text = (raw ?? "").trim();

  if (!text) {
    return { valid: false, reason: "empty", messageHe: INVALID_MESSAGE_HE };
  }

  // Normalize whitespace once for length-based checks.
  const compact = text.replace(/\s+/g, "");

  // Pure single-char repetition like "עעעע", "....", "aaaa".
  if (SINGLE_CHAR_REPEAT_RE.test(compact)) {
    return { valid: false, reason: "single_char_repeat", messageHe: INVALID_MESSAGE_HE };
  }

  // Short repeated pattern like "abcabcabc", "123123123" (only when no legal markers).
  const hasAnyLegalMarker =
    LEGAL_ABBR_RE.test(text) ||
    LEGAL_KEYWORD_RE.test(text) ||
    CASE_NUMBER_RE.test(text) ||
    PARTY_SEPARATOR_RE.test(text) ||
    URL_RE.test(text);

  if (!hasAnyLegalMarker && SHORT_PATTERN_REPEAT_RE.test(compact) && compact.length <= 12) {
    return { valid: false, reason: "pattern_repeat", messageHe: INVALID_MESSAGE_HE };
  }

  // Allow-list short input with a clear legal marker — even tiny strings like "ע\"א 248/86" pass.
  if (hasAnyLegalMarker) {
    return { valid: true };
  }

  // Below this point, no legal marker was found — apply stricter quality gates.

  // Too short to be meaningful without a legal marker.
  if (compact.length < 6) {
    return { valid: false, reason: "too_short", messageHe: INVALID_MESSAGE_HE };
  }

  const hasHebrew = HEBREW_LETTER.test(text);

  // Latin/digit-only random garbage with no legal marker → reject.
  if (!hasHebrew && LATIN_OR_DIGIT_ONLY_RE.test(text) && text.length < 18) {
    return { valid: false, reason: "latin_garbage", messageHe: INVALID_MESSAGE_HE };
  }

  // Require ≥ 2 distinct meaningful tokens (≥ 2 chars each) as a generic catch-all.
  const tokens = text
    .split(/[\s,.;:!?()[\]{}"״׳'\\/|–—-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const distinctTokens = new Set(tokens.map((t) => t.toLowerCase()));

  if (distinctTokens.size < 2) {
    return { valid: false, reason: "no_meaningful_tokens", messageHe: INVALID_MESSAGE_HE };
  }

  return { valid: true };
}

/**
 * Detects AI responses that are effectively a refusal / "cannot interpret"
 * answer. Used as a fallback to refund credit after the AI runs.
 */
export function isRefusalResponse(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;

  // Canonical Hebrew refusal phrases the model produces.
  const refusalPhrases = [
    "אינו יכול לפרש",
    "לא ניתן לפרש",
    "לא ניתן לעבד",
    "לא נמצא טקסט משפטי",
    "הקלט אינו ברור",
    "הבקשה אינה ברורה",
    "לא הצלחתי להבין",
    "אין מספיק מידע",
    "cannot interpret",
    "unable to interpret",
    "could not interpret",
  ];
  if (refusalPhrases.some((p) => t.toLowerCase().includes(p.toLowerCase()))) {
    return true;
  }

  // Defensive: very short response that contains an apology/refusal token AND
  // has none of the typical citation markers.
  const hasCitationMarker =
    /חוק|סעיף|פקודת|תקנות|ע["״]א|ת["״]א|בג["״]ץ|פ["״]ד|ס["״]ח|ק["״]ת|נ['׳]|https?:\/\//.test(t);
  const hasApologyToken = /(אינו|לא ניתן|לא נמצא|מצטער|sorry|unable)/i.test(t);
  if (!hasCitationMarker && hasApologyToken && t.length < 220) {
    return true;
  }

  return false;
}
