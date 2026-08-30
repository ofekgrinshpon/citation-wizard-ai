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
  headings_stripped: number;
  urls_stripped: number;
  paragraph_trimmed: boolean;
  word_count: number | null;
  notice: "thin" | "sourced";
  notices_suppressed: number;
  /** Paragraphs dropped because they pivoted to an unrelated legal domain. */
  drift_paragraphs_dropped: number;
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

/** Drops paragraphs that pivot to a legal domain the question never raised. */
export function dropTopicDrift(
  body: string,
  question: string,
): { text: string; dropped: number } {
  const q = question ?? "";
  const foreign = DRIFT_DOMAINS.filter((d) => !d.re.test(q));
  if (!foreign.length) return { text: body, dropped: 0 };
  const paras = body.split(/\n{2,}/);
  let dropped = 0;
  const kept = paras.filter((p) => {
    const hits = foreign.filter((d) => d.re.test(p)).length;
    // Conservative: only drop when the paragraph is genuinely about the foreign
    // domain (a marker present) and enough prose remains after the drop.
    if (hits > 0 && paras.length - dropped > 2) {
      dropped++;
      return false;
    }
    return true;
  });
  return { text: kept.join("\n\n"), dropped };
}




/** Does the user's own question explicitly ask for a list / outline? */
export function userAskedForList(question: string): boolean {
  return /(רשימה|בנקודות|בתבליט|מתווה|ראשי פרקים|ראשי-פרקים|בולטים)/.test(question ?? "");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Convert bullet lines into ordinary prose sentences, preserving paragraphs. */
function bulletsToProse(body: string): { text: string; converted: number } {
  const lines = body.split("\n");
  const out: string[] = [];
  let converted = 0;
  let run: string[] = [];

  const flush = () => {
    if (!run.length) return;
    // Keep readability: one prose paragraph per contiguous bullet run.
    out.push(
      run
        .map((s) => (/[.!?:;]$/.test(s) ? s : `${s}.`))
        .join(" "),
    );
    run = [];
  };

  for (const raw of lines) {
    if (BULLET_RE.test(raw) && raw.trim().length > 2) {
      converted++;
      run.push(raw.replace(BULLET_RE, "").trim());
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return { text: out.join("\n"), converted };
}

function stripHeadings(body: string): { text: string; stripped: number } {
  let stripped = 0;
  const text = body
    .split("\n")
    .map((line) => {
      if (HEADING_RE.test(line)) {
        stripped++;
        return line.replace(HEADING_RE, "").trim();
      }
      const bold = line.match(BOLD_ONLY_HEADING_RE);
      if (bold) {
        stripped++;
        return bold[1].trim();
      }
      return line;
    })
    .join("\n");
  return { text, stripped };
}

/** Remove raw URLs from prose; markdown links keep only their label. */
export function stripUrlsFromProse(body: string): { text: string; stripped: number } {
  let stripped = 0;
  let text = body.replace(MD_LINK_RE, (_m, label) => {
    stripped++;
    return String(label);
  });
  text = text.replace(URL_RE, () => {
    stripped++;
    return "";
  });
  // tidy the punctuation/whitespace left behind
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\(\s*\)/g, "").trimEnd())
    .join("\n");
  return { text, stripped };
}

/** argument_paragraph: keep one focused paragraph, 150–300 words target. */
function enforceSingleParagraph(body: string): { text: string; trimmed: boolean; words: number } {
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return { text: body, trimmed: false, words: 0 };
  let text = paras[0];
  let trimmed = paras.length > 1;
  // If the opener is too short, absorb following paragraphs up to the ceiling.
  let i = 1;
  while (countWords(text) < 150 && i < paras.length) {
    const merged = `${text} ${paras[i]}`;
    if (countWords(merged) > 330) break;
    text = merged;
    i++;
  }
  if (i >= paras.length) trimmed = paras.length > 1;
  // Hard ceiling: cut at a sentence boundary near 300 words.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 320) {
    const cut = words.slice(0, 300).join(" ");
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    text = lastStop > 200 ? cut.slice(0, lastStop + 1) : `${cut}.`;
    trimmed = true;
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
  let headings = 0;
  let paragraph_trimmed = false;
  let word_count: number | null = null;

  if (isProse) {
    const b = bulletsToProse(body);
    body = b.text;
    bullets = b.converted;
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

  return {
    answer: body + tail,
    report: {
      applied: true,
      genre,
      prose_enforced: isProse,
      bullets_converted: bullets,
      headings_stripped: headings,
      urls_stripped: u.stripped,
      paragraph_trimmed,
      word_count,
      notice,
      notices_suppressed: opts.noticesSuppressed ?? 0,
      drift_paragraphs_dropped: drift.dropped,
    },
  };
}
