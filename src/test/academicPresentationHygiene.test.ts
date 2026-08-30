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
  it("converts bullets into prose for prose genres", () => {
    const r = run("פתיח.\n\n- מבחן הקשר הרציונלי\n- מבחן האמצעי שפגיעתו פחותה\n- מבחן המידתיות במובן הצר");
    expect(r.report.bullets_converted).toBe(3);
    expect(r.answer).not.toMatch(/^\s*-\s+/m);
    expect(r.answer).toContain("מבחן הקשר הרציונלי.");
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

  it("strips markdown headings in prose genres", () => {
    const r = run("## רקע\nטקסט.");
    expect(r.report.headings_stripped).toBe(1);
    expect(r.answer).not.toContain("##");
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
    expect(r.report.word_count!).toBeLessThanOrEqual(330);
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

  it("keeps the domain when the user raised it", () => {
    const r = run(
      "פסקה אחת.\n\nפסקה על בית דין רבני.\n\nפסקה שלישית.\n\nרביעית.",
      { question: "כתוב רקע על ביקורת בג\"ץ על בית דין רבני" },
    );
    expect(r.report.drift_paragraphs_dropped).toBe(0);
  });
});
