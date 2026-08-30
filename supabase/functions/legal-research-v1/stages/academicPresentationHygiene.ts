// academic_draft_presentation_hygiene_v1
// Deterministic display-only cleanup for academic-writing answers.
// Never touches retrieval, sufficiency, identity or footnote content — it only
// reshapes the rendered answer body and picks the single trailing note.

export type AcademicGenre =
  | "introduction"
  | "theoretical_background"
  | "research_question"
  | "chapter_outline"
  | "argument_paragraph"
  | "topic_presentation"
  | "generic_academic";

/** Genres that must render as continuous prose (no bullet lists). */
export const PROSE_GENRES: AcademicGenre[] = [
  "introduction",
  "theoretical_background",
  "topic_presentation",
  "argument_paragraph",
];

export const ACADEMIC_NOTE_THIN_HE =
  "*הערת עבודה: זוהי טיוטה אקדמית ראשונית. לפני הגשה יש להשלים הפניות מדויקות לפסיקה ולספרות.*";
export const ACADEMIC_NOTE_SOURCED_HE =
  "*הערת עבודה: הטיוטה מבוססת על המקורות שאותרו, אך לפני הגשה יש לוודא התאמה מלאה להנחיות הקורס.*";

const BULLET_RE = /^\s*(?:[-–—•*]|\d+[.)]|[א-ת][.)])\s+/;
const HEADING_RE = /^\s*#{1,6}\s+/;
const BOLD_ONLY_HEADING_RE = /^\s*\*\*(.+?)\*\*\s*:?\s*$/;
const URL_RE = /(?:\(|\[|<)?\bhttps?:\/\/[^\s)\]<>"']+(?:\)|\]|>)?/g;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

export interface AcademicHygieneReport {
  applied: boolean;
  genre: AcademicGenre;
  prose_enforced: boolean;
  bullets_converted: number;
  /** academic_drafter_prompt_conflict_cleanup_v1 — bullet runs kept as
   * separate prose paragraphs instead of being concatenated into a
   * disguised list. */
  bullets_preserved: number;
  bullets_converted_or_preserved: "converted" | "preserved" | "mixed" | "none";
  headings_stripped: number;
  urls_stripped: number;
  punctuation_repairs: number;
  paragraph_trimmed: boolean;
  word_count: number | null;
  notice: "thin" | "sourced";
  notices_suppressed: number;
  /** Paragraphs dropped because they pivoted to an unrelated legal domain. */
  drift_paragraphs_dropped: number;
  hygiene_softened: boolean;
}

/**
 * Off-topic domain markers. A paragraph that leans on one of these domains is
 * dropped when the user's own question never mentions that domain — this is the
 * deterministic half of the topic-drift guard (the prompt carries the other).
 */
const DRIFT_DOMAINS: Array<{ id: string; re: RegExp }> = [
  { id: "religious_courts", re: /(בית[- ]דין רבני|בתי[- ]דין רבניים|בית[- ]דין דתי|בתי[- ]דין דתיים|שיפוט דתי|הדין העברי|בית[- ]הדין השרעי)/ },
  { id: "family", re: /(גירושין|חלוקת רכוש|משמורת|מזונות ילדים|הסכם ממון)/ },
  { id: "criminal", re: /(הליך פלילי|כתב אישום|עונשין|מעצר ימים)/ },
  { id: "labor", re: /(בית הדין לעבודה|יחסי עובד[- ]מעביד|פיטורים שלא כדין)/ },
  { id: "tax", re: /(פקודת מס הכנסה|מע"מ|שומת מס)/ },
];

/** Discourse openers that dangle once the preceding paragraph is removed. */
const DANGLING_CONNECTIVE_RE =
  /^\s*(לעומת זאת|מנגד|עם זאת|יתרה מכך|יתר על כן|בנוסף לכך|בנוסף|כמו כן|לפיכך|לכן|משכך|על כן)\s*,?\s*/;

/**
 * Drops paragraphs that pivot to a legal domain the question never raised.
 *
 * academic_drafter_prompt_conflict_cleanup_v1: the drop decision is computed
 * for all paragraphs up front, so it no longer depends on paragraph position,
 * and a paragraph that follows a dropped one loses a now-dangling connective
 * so the surviving neighbours still read as continuous prose.
 */
export function dropTopicDrift(
  body: string,
  question: string,
): { text: string; dropped: number } {
  const q = question ?? "";
  const foreign = DRIFT_DOMAINS.filter((d) => !d.re.test(q));
  if (!foreign.length) return { text: body, dropped: 0 };
  const paras = body.split(/\n{2,}/);
  // Position-independent: score every paragraph first.
  const drifting = paras.map((p) => foreign.some((d) => d.re.test(p)));
  const driftCount = drifting.filter(Boolean).length;
  if (!driftCount) return { text: body, dropped: 0 };
  // Conservative floor: never leave fewer than 3 paragraphs behind.
  if (paras.length - driftCount < 3) return { text: body, dropped: 0 };

  const kept: string[] = [];
  let dropped = 0;
  let previousDropped = false;
  for (let i = 0; i < paras.length; i++) {
    if (drifting[i]) {
      dropped++;
      previousDropped = true;
      continue;
    }
    let text = paras[i];
    if (previousDropped) text = text.replace(DANGLING_CONNECTIVE_RE, "");
    previousDropped = false;
    kept.push(text.trim());
  }
  return { text: kept.join("\n\n"), dropped };
}




/** Does the user's own question explicitly ask for a list / outline? */
export function userAskedForList(question: string): boolean {
  return /(רשימה|בנקודות|בתבליט|מתווה|ראשי פרקים|ראשי-פרקים|בולטים)/.test(question ?? "");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Convert bullet lines into prose.
 *
 * academic_drafter_prompt_conflict_cleanup_v1: concatenating a long bullet run
 * into a single paragraph produced exactly the "disguised list" the style guide
 * bans. Runs of up to 3 items are still joined into one paragraph; longer runs
 * are preserved as separate prose paragraphs (marker stripped) so the text does
 * not read as a flattened list.
 */
function bulletsToProse(
  body: string,
): { text: string; converted: number; preserved: number } {
  const lines = body.split("\n");
  const out: string[] = [];
  let converted = 0;
  let preserved = 0;
  let run: string[] = [];

  const asSentence = (s: string) => (/[.!?:;]$/.test(s) ? s : `${s}.`);

  const flush = () => {
    if (!run.length) return;
    if (run.length > 3) {
      // Long run: keep each item as its own prose paragraph.
      preserved += run.length;
      out.push(run.map(asSentence).join("\n\n"));
    } else {
      converted += run.length;
      out.push(run.map(asSentence).join(" "));
    }
    run = [];
  };

  for (const raw of lines) {
    if (BULLET_RE.test(raw) && raw.trim().length > 2) {
      run.push(raw.replace(BULLET_RE, "").trim());
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return { text: out.join("\n"), converted, preserved };
}

/**
 * Strip markdown/bold-only headings.
 *
 * academic_drafter_prompt_conflict_cleanup_v1: a stripped heading used to be
 * left as an orphan line inside the prose. It is now folded into the paragraph
 * that follows it (as an opening sentence), or dropped when nothing follows.
 */
function stripHeadings(body: string): { text: string; stripped: number } {
  let stripped = 0;
  const lines = body.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let headingText: string | null = null;
    if (HEADING_RE.test(line)) headingText = line.replace(HEADING_RE, "").trim();
    else {
      const bold = line.match(BOLD_ONLY_HEADING_RE);
      if (bold) headingText = bold[1].trim();
    }
    if (headingText === null) {
      out.push(line);
      continue;
    }
    stripped++;
    // Find the next non-empty line and fold the heading into it.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length) {
      const head = /[.!?:;]$/.test(headingText) ? headingText : `${headingText}.`;
      lines[j] = `${head} ${lines[j].trim()}`;
      i = j - 1; // skip the blank lines we consumed
    }
    // nothing follows -> the orphan heading is simply dropped
  }
  return { text: out.join("\n"), stripped };
}

/**
 * Repairs punctuation residue left behind after a URL is removed
 * (e.g. "ראו , וגם" -> "ראו וגם", "()" -> "", ",," -> ",").
 */
export function repairPunctuationResidue(text: string): { text: string; repairs: number } {
  let repairs = 0;
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  let out = text;
  const rules: Array<[RegExp, string]> = [
    [/\(\s*\)/g, ""],
    [/\[\s*\]/g, ""],
    [/<\s*>/g, ""],
    // stray separator directly after a word boundary: "ראו , וגם"
    [/(\S)\s+([,;:])(\s|$)/g, "$1$2$3"],
    // duplicated separators
    [/([,;:])\s*[,;:]+/g, "$1"],
    // a separator that now opens a clause
    [/(^|\n)\s*[,;:]\s*/g, "$1"],
    // separator immediately before a full stop
    [/[,;:]\s*\./g, "."],
    // orphan comma before a conjunction left by the removal
    [/,\s+(ו|וגם|או)\s/g, " $1 "],
    [/\s{2,}/g, " "],
    [/\s+\./g, "."],
  ];
  for (const [re, rep] of rules) {
    const before = count(out, re);
    if (before) {
      out = out.replace(re, rep);
      repairs += before;
    }
  }
  return { text: out, repairs };
}

/** Remove raw URLs from prose; markdown links keep only their label. */
export function stripUrlsFromProse(
  body: string,
): { text: string; stripped: number; repairs: number } {
  let stripped = 0;
  let text = body.replace(MD_LINK_RE, (_m, label) => {
    stripped++;
    return String(label);
  });
  text = text.replace(URL_RE, () => {
    stripped++;
    return "";
  });
  // tidy the punctuation/whitespace left behind, line by line
  let repairs = 0;
  text = text
    .split("\n")
    .map((l) => {
      if (!l.trim()) return l;
      const r = repairPunctuationResidue(l);
      repairs += r.repairs;
      return r.text.trimEnd();
    })
    .join("\n");
  return { text, stripped, repairs };
}

/**
 * argument_paragraph: keep one focused paragraph.
 *
 * academic_drafter_prompt_conflict_cleanup_v1: a complete argument beats a
 * mechanically trimmed one. Nothing is cut below 340 words, and above that the
 * cut only happens at a real sentence boundary — if none exists in range the
 * paragraph is left intact.
 */
const ARGUMENT_SOFT_FLOOR = 150;
const ARGUMENT_MERGE_CEILING = 380;
const ARGUMENT_TRIM_THRESHOLD = 340;

function enforceSingleParagraph(body: string): { text: string; trimmed: boolean; words: number } {
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return { text: body, trimmed: false, words: 0 };
  let text = paras[0];
  // If the opener is too short, absorb following paragraphs up to the ceiling.
  let i = 1;
  while (countWords(text) < ARGUMENT_SOFT_FLOOR && i < paras.length) {
    const merged = `${text} ${paras[i]}`;
    if (countWords(merged) > ARGUMENT_MERGE_CEILING) break;
    text = merged;
    i++;
  }
  let trimmed = paras.length > 1;
  // Soft ceiling: only trim well past the target, and only at a sentence end.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > ARGUMENT_TRIM_THRESHOLD) {
    const cut = words.slice(0, ARGUMENT_TRIM_THRESHOLD).join(" ");
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    // Never cut mid-move: require a sentence boundary in the back half.
    if (lastStop > cut.length * 0.5) {
      text = cut.slice(0, lastStop + 1);
      trimmed = true;
    }
  }
  return { text, trimmed, words: countWords(text) };
}

export interface HygieneOptions {
  genre: AcademicGenre;
  question: string;
  thinSources: boolean;
  /** Titles of found-but-unread sources worth surfacing after the note. */
  followUpTitles?: string[];
  /** Number of legacy limitation notices that were suppressed upstream. */
  noticesSuppressed?: number;
}

/**
 * Applies presentation hygiene to an academic answer body and appends exactly
 * one trailing "הערת עבודה" note (plus an optional compact follow-up block).
 */
export function applyAcademicPresentationHygiene(
  answerMarkdown: string,
  opts: HygieneOptions,
): { answer: string; report: AcademicHygieneReport } {
  const genre = opts.genre;
  const isProse = PROSE_GENRES.includes(genre) && !userAskedForList(opts.question ?? "");

  let body = answerMarkdown;
  let bullets = 0;
  let preserved = 0;
  let headings = 0;
  let paragraph_trimmed = false;
  let word_count: number | null = null;

  if (isProse) {
    const b = bulletsToProse(body);
    body = b.text;
    bullets = b.converted;
    preserved = b.preserved;
    const h = stripHeadings(body);
    body = h.text;
    headings = h.stripped;
  }

  const u = stripUrlsFromProse(body);
  body = u.text;

  const drift = dropTopicDrift(body, opts.question ?? "");
  body = drift.text;

  if (isProse && genre === "argument_paragraph") {
    const p = enforceSingleParagraph(body);
    body = p.text;
    paragraph_trimmed = p.trimmed;
    word_count = p.words;
  }

  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const notice = opts.thinSources ? "thin" : "sourced";
  const noteText = opts.thinSources ? ACADEMIC_NOTE_THIN_HE : ACADEMIC_NOTE_SOURCED_HE;

  let tail = `\n\n${noteText}\n`;
  const follow = (opts.followUpTitles ?? []).filter(Boolean).slice(0, 3);
  if (follow.length) {
    tail += `\n**להמשך בדיקה:** ${follow.map((t) => t.replace(URL_RE, "").trim()).join(" · ")}\n`;
  }

  const bullets_converted_or_preserved: AcademicHygieneReport["bullets_converted_or_preserved"] =
    bullets && preserved ? "mixed" : preserved ? "preserved" : bullets ? "converted" : "none";

  return {
    answer: body + tail,
    report: {
      applied: true,
      genre,
      prose_enforced: isProse,
      bullets_converted: bullets,
      bullets_preserved: preserved,
      bullets_converted_or_preserved,
      headings_stripped: headings,
      urls_stripped: u.stripped,
      punctuation_repairs: u.repairs,
      paragraph_trimmed,
      word_count,
      notice,
      notices_suppressed: opts.noticesSuppressed ?? 0,
      drift_paragraphs_dropped: drift.dropped,
      hygiene_softened: true,
    },
  };
}
