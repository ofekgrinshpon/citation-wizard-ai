/**
 * Deterministic premise / framing validation for *named doctrine* questions.
 *
 * Problem: a user may ask "מה הפסיקה אומרת על הלכת יורש אחר יורש?" — a real
 * statutory institution (סעיף 42 לחוק הירושה) that is **not** a recognized
 * named הלכה. The pipeline used to answer as if the named doctrine exists.
 *
 * This module adds no LLM call and no doctrine dictionary. It only asks:
 *   1. Did the user frame the question as a *named* doctrine ("הלכת X",
 *      "דוקטרינת X", "עקרון X", "כלל X", "מה ההלכה לגבי X")?
 *   2. Does the **full named phrase** ("הלכת X") actually appear in a
 *      surviving citable authority? Substring hits on X alone do not count.
 *   3. If not — is the bare subject X nonetheless present in a citable
 *      authority (i.e. a real nearby legal institution)?
 *
 * When (1) holds and (2) fails, the drafter is instructed to open with a
 * framing correction instead of validating the user's premise.
 */

import type { DrafterInputSource } from "./drafter.ts";

export type NamedDoctrineKind = "halacha" | "doctrine" | "principle" | "rule";

export interface NamedDoctrineFraming {
  /** Whether the question is phrased as a named doctrine at all. */
  is_named_doctrine_question: boolean;
  kind?: NamedDoctrineKind;
  /** The full named phrase as the user framed it, e.g. "הלכת יורש אחר יורש". */
  named_doctrine_phrase: string | null;
  /** The bare subject without the doctrine word, e.g. "יורש אחר יורש". */
  subject_phrase: string | null;
  /** Full-phrase variants that were searched for in citable authorities. */
  recognized_phrase_variants: string[];
  /** Refs of citable authorities containing the full named phrase. */
  recognized_phrase_matches: string[];
  /** True when at least one citable authority uses the full named phrase. */
  named_doctrine_recognized: boolean;
  /** Refs of citable authorities that mention the bare subject. */
  nearby_institution_refs: string[];
  nearby_legal_institution_found: boolean;
  /** Final signal consumed by the drafter. */
  framing_correction_required: boolean;
  reason: string;
}

const DOCTRINE_WORDS: Array<{ kind: NamedDoctrineKind; words: string[]; variants: string[] }> = [
  { kind: "halacha", words: ["הלכת", "הילכת"], variants: ["הלכת", "הילכת", "הלכה"] },
  { kind: "doctrine", words: ["דוקטרינת"], variants: ["דוקטרינת", "דוקטרינה"] },
  { kind: "principle", words: ["עקרון", "עיקרון"], variants: ["עקרון", "עיקרון", "העקרון"] },
  { kind: "rule", words: ["כלל", "הכלל"], variants: ["כלל", "הכלל"] },
];

// Tokens that terminate the doctrine name.
const STOP_TOKENS = new Set([
  "על", "של", "את", "עם", "לפי", "בין", "כי", "אם", "או", "גם", "מן", "אשר",
  "לגבי", "בנוגע", "בעניין", "כמו", "אך", "אבל", "יש", "אין", "היא", "הוא",
  "זה", "זו", "מה", "כל", "כדי", "אלא", "לא", "כן", "בישראל", "הישראלי",
  "הישראלית", "בדין", "במשפט", "כיום", "היום", "בפסיקה", "בחוק",
]);

const MAX_SUBJECT_TOKENS = 5;

function normalize(text: string): string {
  return String(text || "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["׳״''`,.;:?!()[\]{}<>«»—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHe(token: string): string {
  return token.startsWith("ה") && token.length > 3 ? token.slice(1) : token;
}

/**
 * Detect a named-doctrine framing in the question and extract its subject.
 */
export function detectNamedDoctrine(
  question: string,
): { kind: NamedDoctrineKind; phrase: string; subject: string } | null {
  const tokens = normalize(question).split(" ").filter(Boolean);

  // "מה ההלכה לגבי X" / "מהי ההלכה בעניין X" → named-doctrine framing on X.
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === "ההלכה" || tokens[i] === "הלכה") &&
        (tokens[i + 1] === "לגבי" || tokens[i + 1] === "בעניין" || tokens[i + 1] === "בנוגע")) {
      const rest = tokens.slice(tokens[i + 2] === "ל" ? i + 3 : i + 2);
      const subject = takeSubject(rest);
      if (subject) return { kind: "halacha", phrase: `הלכת ${subject}`, subject };
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    for (const entry of DOCTRINE_WORDS) {
      if (!entry.words.includes(tokens[i])) continue;
      const subject = takeSubject(tokens.slice(i + 1));
      if (!subject) continue;
      return { kind: entry.kind, phrase: `${tokens[i]} ${subject}`, subject };
    }
  }
  return null;
}

function takeSubject(rest: string[]): string | null {
  const out: string[] = [];
  for (const tok of rest) {
    if (out.length >= MAX_SUBJECT_TOKENS) break;
    if (STOP_TOKENS.has(tok)) break;
    if (!/[\u0590-\u05FF]/.test(tok) && !/^\d/.test(tok)) break;
    out.push(tok);
  }
  return out.length ? out.join(" ") : null;
}

function isCitableAuthority(s: DrafterInputSource): boolean {
  if (s.citable_as === "not_citable") return false;
  if (s.authority_tier === "index_or_listing" || s.authority_tier === "non_authority") return false;
  if (s.text_usability === "listing_page") return false;
  return true;
}

function haystack(s: DrafterInputSource): string {
  return normalize(`${s.title} ${s.snippet ?? ""}`);
}

function subjectMentioned(subject: string, hay: string): boolean {
  if (hay.includes(subject)) return true;
  const toks = subject.split(" ").filter((t) => t.length >= 2);
  if (toks.length < 2) return false;
  // Order-free all-token match tolerates inflection/parenthetical noise.
  return toks.every((t) => hay.includes(t) || hay.includes(stripHe(t)));
}

export function assessNamedDoctrineFraming(args: {
  question: string;
  sources: DrafterInputSource[];
}): NamedDoctrineFraming {
  const { question, sources } = args;
  const detected = detectNamedDoctrine(question);

  if (!detected) {
    return {
      is_named_doctrine_question: false,
      named_doctrine_phrase: null,
      subject_phrase: null,
      recognized_phrase_variants: [],
      recognized_phrase_matches: [],
      named_doctrine_recognized: false,
      nearby_institution_refs: [],
      nearby_legal_institution_found: false,
      framing_correction_required: false,
      reason: "not_a_named_doctrine_question",
    };
  }

  const entry = DOCTRINE_WORDS.find((e) => e.kind === detected.kind)!;
  const subjects = new Set<string>([detected.subject]);
  const firstTok = detected.subject.split(" ")[0];
  if (firstTok && stripHe(firstTok) !== firstTok) {
    subjects.add([stripHe(firstTok), ...detected.subject.split(" ").slice(1)].join(" "));
  }
  const variants: string[] = [];
  for (const w of entry.variants) {
    for (const subj of subjects) variants.push(`${w} ${subj}`);
  }

  const citable = sources.filter(isCitableAuthority);
  const recognizedMatches: string[] = [];
  const nearbyRefs: string[] = [];
  for (const s of citable) {
    const hay = haystack(s);
    if (variants.some((v) => hay.includes(v))) recognizedMatches.push(s.ref);
    if ([...subjects].some((subj) => subjectMentioned(subj, hay))) nearbyRefs.push(s.ref);
  }

  const recognized = recognizedMatches.length > 0;
  const nearby = nearbyRefs.length > 0;

  return {
    is_named_doctrine_question: true,
    kind: detected.kind,
    named_doctrine_phrase: detected.phrase,
    subject_phrase: detected.subject,
    recognized_phrase_variants: variants,
    recognized_phrase_matches: recognizedMatches,
    named_doctrine_recognized: recognized,
    nearby_institution_refs: nearbyRefs,
    nearby_legal_institution_found: nearby,
    // Only correct the framing when we actually have citable material to talk
    // about — otherwise the sufficiency gate / limitation branches own the
    // answer and a framing correction would be noise.
    framing_correction_required: !recognized && nearby,
    reason: recognized
      ? "named_doctrine_recognized_in_authority"
      : nearby
      ? "named_phrase_unsupported_nearby_institution_found"
      : "no_citable_support_for_named_phrase",
  };
}
