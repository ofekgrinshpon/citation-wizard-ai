import { describe, expect, it } from "vitest";
import {
  assessBodyCompleteness,
  BODY_COMPLETENESS_LIMITS,
  confirmsArticleIdentity,
  findSamePageFullText,
  runLiteratureBodyCompleteness,
  selectReextractionCandidates,
  type BodyCompletenessAssessment,
  type ReextractionCandidateView,
} from "../../supabase/functions/legal-research-v1/stages/literatureBodyCompleteness.ts";

const ARTICLE_BLOCK = `
עילת הסבירות היא דוקטרינה מרכזית במשפט המנהלי הישראלי, ובבסיסה עומדת ההנחה כי שיקול הדעת המנהלי כפוף לביקורת שיפוטית מהותית ולא רק פרוצדורלית. לטענת המצדדים בעילה, ללא ביקורת סבירות תיוותר הרשות המנהלית ללא בקרה אפקטיבית על איזון בין שיקולים מתחרים, ובכך ייפגע עקרון שלטון החוק.
מנגד, מבקרי העילה טוענים כי מדובר בהרחבה שיפוטית של הפסיקה אשר מעבירה הכרעות ערכיות מן הרשות הנבחרת לבית המשפט. לפיכך יש לטעון כי הדיון הנורמטיבי אינו מתמצה בשאלת קיומה של העילה אלא בשאלת עוצמת ההתערבות ובניתוח הנימוקים המוסדיים העומדים בבסיסה.
בניגוד לגישה זו, גישה שלישית מציעה פרשנות מצמצמת המבחינה בין סבירות מנהלית לבין מידתיות, ומכאן שהמחלוקת היא בעיקרה מחלוקת על היקף ההלכה ולא על עצם קיומה.
`.trim();

/** ~2k chars: long enough to be classifiable, short enough to stay under the length shortcut. */
const ARGUMENTATIVE = [ARTICLE_BLOCK, ARTICLE_BLOCK, ARTICLE_BLOCK].join("\n");

function view(over: Partial<ReextractionCandidateView> = {}): ReextractionCandidateView {
  return {
    source_id: "c1",
    title: "עילת הסבירות במשפט המנהלי — עיוני משפט",
    url: "https://law.tau.ac.il/article/1",
    source_type: "legal_article",
    role_before: "scholarship",
    body: "כותרת בלבד",
    strong_direct: true,
    blocker: "body_evidence_too_weak_to_override_slot",
    ...over,
  };
}

describe("assessBodyCompleteness", () => {
  it("marks a substantive argumentative article complete", () => {
    const a = assessBodyCompleteness({ source_id: "c1", title: "מאמר", body: ARGUMENTATIVE });
    expect(a.completeness).toBe("complete");
    expect(a.paragraph_count).toBeGreaterThanOrEqual(2);
    expect(a.legal_substance_terms_count).toBeGreaterThan(3);
  });

  it("detects an empty body as failed", () => {
    expect(assessBodyCompleteness({ source_id: "c", title: "t", body: "" }).completeness)
      .toBe("failed");
  });

  it("detects metadata-only bodies", () => {
    const a = assessBodyCompleteness({ source_id: "c", title: "t", body: "מאת פרופ' פלוני" });
    expect(a.completeness).toBe("metadata_only");
    expect(a.reason).toBe("title_or_metadata_only");
  });

  it("detects abstract-only bodies", () => {
    const body = `תקציר\n${"מאמר זה בוחן את עילת הסבירות ואת הביקורת עליה. ".repeat(12)}`;
    const a = assessBodyCompleteness({ source_id: "c", title: "t", body });
    expect(a.has_abstract_only).toBe(true);
    expect(a.completeness).toBe("metadata_only");
  });

  it("detects listing pages", () => {
    const body = `תוצאות חיפוש\nמאמר א\nמאמר ב\nמאמר ג\n${"גיליונות קודמים ".repeat(10)}`;
    const a = assessBodyCompleteness({ source_id: "c", title: "t", body });
    expect(a.completeness).toBe("listing_like");
    expect(a.listing_like).toBe(true);
  });

  it("detects PDF extraction failures", () => {
    const a = assessBodyCompleteness({
      source_id: "c",
      title: "t",
      body: "%PDF-1.4 obj << endstream " + "x".repeat(2000),
    });
    expect(a.completeness).toBe("failed");
    expect(a.extraction_failure_signals.length).toBeGreaterThan(0);
  });

  it("flags navigation-dominated bodies as partial", () => {
    const nav = ["דף הבית", "תפריט", "צור קשר", "מפת האתר", "תנאי שימוש", "מדיניות פרטיות"];
    const body = [...nav, ...nav, ...nav, "כל הזכויות שמורות", "עילת הסבירות"].join("\n") +
      "\n" + "טקסט קצר. ".repeat(60);
    const a = assessBodyCompleteness({ source_id: "c", title: "t", body });
    expect(a.navigation_noise_ratio).toBeGreaterThan(0.5);
    expect(a.completeness).toBe("partial");
  });

  it("flags a short body below the classification floor as partial", () => {
    const a = assessBodyCompleteness({
      source_id: "c",
      title: "t",
      body: "עילת הסבירות ודוקטרינת הביקורת השיפוטית. ".repeat(8),
    });
    expect(a.body_chars).toBeLessThan(BODY_COMPLETENESS_LIMITS.MIN_CLASSIFIABLE_CHARS);
    expect(a.completeness).toBe("partial");
  });
});

describe("selectReextractionCandidates", () => {
  const assess = (vs: ReextractionCandidateView[]) => {
    const m = new Map<string, BodyCompletenessAssessment>();
    for (const v of vs) m.set(v.source_id, assessBodyCompleteness(v));
    return m;
  };

  it("selects a strong direct partial scholarship candidate", () => {
    const vs = [view({ body: "מאת פרופ' פלוני, עיוני משפט. " + "עילת הסבירות. ".repeat(20) })];
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows[0].selected_for_reextraction).toBe(true);
    expect(rows[0].priority_rank).toBe(1);
  });

  it("never re-extracts judgments or statutes", () => {
    const vs = [view({ source_type: "judgment", body: "קצר" })];
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows[0].selected_for_reextraction).toBe(false);
    expect(rows[0].skipped_reason).toBe("primary_law_or_news_not_reextracted");
  });

  it("never touches paywalled or access-controlled URLs", () => {
    const vs = [view({ url: "https://www.nevo.co.il/psika/x", body: "מאת פלוני" })];
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows[0].skipped_reason).toBe("access_controlled_or_paywalled");
  });

  it("skips already complete bodies", () => {
    const vs = [view({ body: ARGUMENTATIVE })];
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows[0].skipped_reason).toBe("body_already_complete");
  });

  it("skips off-topic and hard-integrity-failed candidates", () => {
    const vs = [
      view({ source_id: "a", topicality: "off_topic", body: "מאת פלוני" }),
      view({ source_id: "b", hard_integrity_failure: true, body: "מאת פלוני" }),
    ];
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows.find((r) => r.source_id === "a")!.skipped_reason).toBe("off_topic_after_body");
    expect(rows.find((r) => r.source_id === "b")!.skipped_reason).toBe("hard_integrity_failure");
  });

  it("caps selection at four candidates per run", () => {
    const vs = Array.from({ length: 7 }, (_, i) =>
      view({
        source_id: `c${i}`,
        url: `https://law.tau.ac.il/a/${i}`,
        body: "מאת פרופ' פלוני, עיוני משפט. " + "עילת הסבירות. ".repeat(20),
      }));
    const rows = selectReextractionCandidates(vs, assess(vs));
    expect(rows.filter((r) => r.selected_for_reextraction).length).toBe(4);
    expect(rows.filter((r) => r.skipped_reason === "over_per_run_reextraction_cap").length).toBe(3);
  });
});

describe("identity and same-page full text", () => {
  it("confirms identity when the body repeats the title terms", () => {
    expect(confirmsArticleIdentity("עילת הסבירות במשפט המנהלי", ARGUMENTATIVE)).toBe(true);
  });

  it("rejects a body that is clearly a different article", () => {
    expect(
      confirmsArticleIdentity(
        "הסתמכות והבטחה מנהלית בדיני מכרזים ציבוריים",
        "פסק דין בעניין תאונת דרכים ופיצויים לנפגעי גוף. ".repeat(40),
      ),
    ).toBe(false);
  });

  it("prefers a same-host PDF link inside the fetched page", () => {
    const html =
      `<html><a href="/files/article.pdf">להורדת המאמר המלא</a><link rel="canonical" href="https://x.ac.il/a/1"/></html>`;
    const link = findSamePageFullText(html, "https://x.ac.il/a/1");
    expect(link?.method).toBe("same_page_pdf");
    expect(link?.url).toContain("article.pdf");
  });

  it("returns null when the page has no full-text link", () => {
    expect(findSamePageFullText("<html><a href='/about'>אודות</a></html>", "https://x.ac.il/a/1"))
      .toBeNull();
  });
});

describe("runLiteratureBodyCompleteness", () => {
  const baseInput = (over: Record<string, unknown> = {}) => {
    const applied: Array<{ id: string; text: string }> = [];
    const vs = [view({ body: "מאת פרופ' פלוני, עיוני משפט. " + "עילת הסבירות. ".repeat(20) })];
    return {
      applied,
      input: {
        run_id: "r1",
        enabled: true,
        views: vs,
        applyBody: (id: string, text: string) => {
          applied.push({ id, text });
          return text.length;
        },
        fetchBody: async () => ({
          text: ARGUMENTATIVE,
          html: null,
          final_url: "https://law.tau.ac.il/article/1",
          status: 200,
          bytes: 4000,
          extraction_method: "html" as const,
        }),
        topicality: () => "direct" as const,
        ...over,
      },
    };
  };

  it("replaces a partial body with a fuller substantive one", async () => {
    const { applied, input } = baseInput();
    const rep = await runLiteratureBodyCompleteness(input);
    expect(rep.ran).toBe(true);
    expect(rep.improved_source_ids).toEqual(["c1"]);
    expect(applied.length).toBe(1);
    expect(rep.results[0].body_replaced).toBe(true);
    expect(rep.results[0].new_completeness).toBe("complete");
  });

  it("keeps the old body when the re-extraction is a listing page", async () => {
    const { applied, input } = baseInput({
      fetchBody: async () => ({
        text: "תוצאות חיפוש\n" + "מאמר ".repeat(400),
        html: null,
        final_url: "u",
        status: 200,
        bytes: 100,
        extraction_method: "html" as const,
      }),
    });
    const rep = await runLiteratureBodyCompleteness(input);
    expect(applied.length).toBe(0);
    expect(rep.results[0].body_replaced).toBe(false);
    expect(rep.improved_source_ids).toEqual([]);
  });

  it("keeps the old body when the new text is off-topic", async () => {
    const { applied, input } = baseInput({ topicality: () => "off_topic" as const });
    const rep = await runLiteratureBodyCompleteness(input);
    expect(applied.length).toBe(0);
    expect(rep.results[0].final_reason).toBe("off_topic_after_reextraction");
  });

  it("keeps the old body when the new text is not materially longer", async () => {
    const { applied, input } = baseInput({
      fetchBody: async () => ({
        text: "עילת הסבירות. ".repeat(21),
        html: null,
        final_url: "u",
        status: 200,
        bytes: 10,
        extraction_method: "html" as const,
      }),
    });
    const rep = await runLiteratureBodyCompleteness(input);
    expect(applied.length).toBe(0);
    expect(rep.results[0].final_reason).not.toBe("body_replaced_with_fuller_extraction");
  });

  it("records fetch failures without touching the candidate", async () => {
    const { applied, input } = baseInput({
      fetchBody: async () => {
        throw new Error("http_403");
      },
    });
    const rep = await runLiteratureBodyCompleteness(input);
    expect(applied.length).toBe(0);
    expect(rep.attempts[0].status).toBe("error");
    expect(rep.attempts[0].rejection_reason).toContain("403");
  });

  it("does nothing when disabled", async () => {
    const { input } = baseInput();
    const rep = await runLiteratureBodyCompleteness({ ...input, enabled: false });
    expect(rep.ran).toBe(false);
    expect(rep.attempts).toEqual([]);
  });

  it("follows at most one same-page link and stops at two variants", async () => {
    let calls = 0;
    const { input } = baseInput({
      fetchBody: async () => {
        calls += 1;
        return {
          text: "מאת פלוני",
          html: `<a href="/f/${calls}.pdf">מאמר מלא</a>`,
          final_url: `https://law.tau.ac.il/f/${calls}`,
          status: 200,
          bytes: 10,
          extraction_method: "html" as const,
        };
      },
    });
    const rep = await runLiteratureBodyCompleteness(input);
    expect(calls).toBe(2);
    expect(rep.attempts.length).toBe(2);
  });
});
