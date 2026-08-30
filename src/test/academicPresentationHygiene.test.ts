// academic_draft_presentation_hygiene_v1 — deterministic hygiene fixtures.
import { describe, expect, it } from "vitest";
import {
  ACADEMIC_NOTE_SOURCED_HE,
  ACADEMIC_NOTE_THIN_HE,
  applyAcademicPresentationHygiene,
  stripUrlsFromProse,
  userAskedForList,
} from "../../supabase/functions/legal-research-v1/stages/academicPresentationHygiene.ts";

const run = (body: string, o: Partial<Parameters<typeof applyAcademicPresentationHygiene>[1]> = {}) =>
  applyAcademicPresentationHygiene(body, {
    genre: "theoretical_background",
    question: "כתוב פרק רקע תיאורטי על מידתיות",
    thinSources: false,
    ...o,
  });

describe("prose enforcement", () => {
  it("converts short bullet runs into prose for prose genres", () => {
    const r = run("פתיח.\n\n- מבחן הקשר הרציונלי\n- מבחן האמצעי שפגיעתו פחותה\n- מבחן המידתיות במובן הצר");
    expect(r.report.bullets_converted).toBe(3);
    expect(r.report.bullets_converted_or_preserved).toBe("converted");
    expect(r.answer).not.toMatch(/^\s*-\s+/m);
    expect(r.answer).toContain("מבחן הקשר הרציונלי.");
  });

  it("preserves long bullet runs as separate prose paragraphs", () => {
    const r = run("פתיח.\n\n- אחד ראשון\n- שניים שני\n- שלושה שלישי\n- ארבעה רביעי\n- חמישה חמישי");
    expect(r.report.bullets_preserved).toBe(5);
    expect(r.report.bullets_converted).toBe(0);
    expect(r.report.bullets_converted_or_preserved).toBe("preserved");
    expect(r.answer).not.toMatch(/^\s*-\s+/m);
    // not flattened into one disguised list paragraph
    expect(r.answer).toContain("אחד ראשון.\n\nשניים שני.");
  });

  it("keeps multiple prose paragraphs", () => {
    const r = run("פסקה ראשונה.\n\nפסקה שנייה.");
    expect(r.answer.split(/\n{2,}/).length).toBeGreaterThan(2); // 2 paragraphs + note
  });

  it("keeps bullets for chapter_outline", () => {
    const r = run("- פרק א\n- פרק ב", { genre: "chapter_outline", question: "כתוב מתווה פרקים" });
    expect(r.report.prose_enforced).toBe(false);
    expect(r.answer).toMatch(/^- פרק א/m);
  });

  it("keeps lists when the user explicitly asked for one", () => {
    expect(userAskedForList("כתוב לי רשימה של מבחני המידתיות")).toBe(true);
    const r = run("- אחד\n- שתיים", { question: "כתוב לי רשימה של מבחנים" });
    expect(r.report.prose_enforced).toBe(false);
  });

  it("folds markdown headings into the following paragraph, no orphan line", () => {
    const r = run("## רקע\nטקסט ראשון.");
    expect(r.report.headings_stripped).toBe(1);
    expect(r.answer).not.toContain("##");
    expect(r.answer).toContain("רקע. טקסט ראשון.");
  });
});

describe("url hygiene", () => {
  it("removes raw urls and keeps link labels", () => {
    const r = stripUrlsFromProse(
      "ראו https://supremedecisions.court.gov.il/x?type=4 וגם [פסק הדין](https://a.b/c).",
    );
    expect(r.text).not.toMatch(/https?:\/\//);
    expect(r.text).toContain("פסק הדין");
    expect(r.stripped).toBe(2);
  });

  it("repairs punctuation residue left by url removal", () => {
    const r = stripUrlsFromProse("ראו (https://a.b/c), וגם ההלכה נקבעה שם.");
    expect(r.text).not.toContain(" , ");
    expect(r.text).not.toContain("()");
    expect(r.text).toContain("וגם ההלכה נקבעה שם.");
    expect(r.repairs).toBeGreaterThan(0);
  });
});

describe("argument paragraph contract", () => {
  it("collapses a multi-paragraph answer into one paragraph", () => {
    const p = (w: string) => Array.from({ length: 90 }, () => w).join(" ");
    const r = run(`${p("טיעון")}.\n\n${p("נספח")}.\n\n${p("עוד")}.`, {
      genre: "argument_paragraph",
      question: "כתוב פסקת טיעון אקדמית",
    });
    const body = r.answer.split("\n\n")[0];
    expect(body).not.toContain("עוד עוד");
    expect(r.report.paragraph_trimmed).toBe(true);
  });

  it("does not trim a complete argument below the 340-word safety ceiling", () => {
    const body = `${"מילה ".repeat(320)}.`;
    const r = run(body, { genre: "argument_paragraph", question: "כתוב פסקת טיעון" });
    expect(r.report.word_count!).toBeGreaterThanOrEqual(320);
  });

  it("never cuts mid-move when no sentence boundary is in range", () => {
    const r = run(`${"מילה ".repeat(400)}.`, {
      genre: "argument_paragraph",
      question: "כתוב פסקת טיעון",
    });
    // no full stop in the first 340 words -> paragraph left intact
    expect(r.report.word_count!).toBeGreaterThan(340);
  });

  it("merges short paragraphs up to the 150-word floor", () => {
    const r = run(`${"מילה ".repeat(60)}\n\n${"אחרת ".repeat(60)}`, {
      genre: "argument_paragraph",
      question: "כתוב פסקת טיעון",
    });
    expect(r.report.word_count!).toBeGreaterThanOrEqual(120);
  });
});

describe("single caveat", () => {
  it("uses the thin-source work note", () => {
    const r = run("טקסט.", { thinSources: true, noticesSuppressed: 3 });
    expect(r.answer).toContain(ACADEMIC_NOTE_THIN_HE);
    expect(r.answer).not.toContain("מגבלת ביסוס");
    expect(r.report.notices_suppressed).toBe(3);
  });

  it("uses the sourced work note and one follow-up block", () => {
    const r = run("טקסט.", { followUpTitles: ["בג\"ץ פלוני", "מאמר אלמוני", "ספר", "עודף"] });
    expect(r.answer).toContain(ACADEMIC_NOTE_SOURCED_HE);
    expect(r.answer).toContain("להמשך בדיקה");
    expect(r.answer).not.toContain("עודף");
    expect((r.answer.match(/הערת עבודה/g) ?? []).length).toBe(1);
  });
});

describe("topic drift guard", () => {
  it("drops a religious-courts pivot from a public-appointments draft", () => {
    const r = run(
      "פסקה על מינויים פוליטיים וביקורת שיפוטית.\n\nפסקה על בית דין רבני ושיפוט דתי.\n\nפסקה על סבירות מנהלית.\n\nפסקה מסכמת.",
      { genre: "research_question", question: "נסח שאלת מחקר על מינויים פוליטיים" },
    );
    expect(r.report.drift_paragraphs_dropped).toBe(1);
    expect(r.answer).not.toContain("בית דין רבני");
  });

  it("repairs the connective of the paragraph after a dropped one", () => {
    const r = run(
      "פסקה על מינויים פוליטיים.\n\nפסקה על בית דין רבני ושיפוט דתי.\n\nלעומת זאת, סבירות מנהלית נבחנת אחרת.\n\nפסקה מסכמת.",
      { genre: "research_question", question: "נסח שאלת מחקר על מינויים פוליטיים" },
    );
    expect(r.answer).not.toContain("לעומת זאת");
    expect(r.answer).toContain("סבירות מנהלית נבחנת אחרת.");
  });

  it("is position-independent and keeps at least three paragraphs", () => {
    // two drifting paragraphs out of four -> dropping would leave 2, so no drop
    const r = run(
      "פסקה על בית דין רבני.\n\nפסקה על שיפוט דתי.\n\nפסקה שלישית.\n\nרביעית.",
      { genre: "research_question", question: "נסח שאלת מחקר על מינויים פוליטיים" },
    );
    expect(r.report.drift_paragraphs_dropped).toBe(0);
  });

  it("keeps the domain when the user raised it", () => {
    const r = run(
      "פסקה אחת.\n\nפסקה על בית דין רבני.\n\nפסקה שלישית.\n\nרביעית.",
      { question: "כתוב רקע על ביקורת בג\"ץ על בית דין רבני" },
    );
    expect(r.report.drift_paragraphs_dropped).toBe(0);
  });
});
