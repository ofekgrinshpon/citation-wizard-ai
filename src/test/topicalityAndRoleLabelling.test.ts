// fix_topicality_and_role_labelling_v1 — deterministic regression fixtures.
import { describe, expect, it } from "vitest";
import { termsMatch } from "../../supabase/functions/legal-research-v1/stages/hebrewTopicTerms.ts";
import {
  coreTopicTerms,
  requiredDirectMatches,
  scoreLiteratureTopicality,
  sharedSubjectTerms,
  subjectTerms,
} from "../../supabase/functions/legal-research-v1/stages/academicLiteratureRichness.ts";
import { classifyBodyTopicality } from "../../supabase/functions/legal-research-v1/stages/academicLiteratureGateRepair.ts";
import {
  deriveRoleFromBody,
  relabelRoleAfterBody,
} from "../../supabase/functions/legal-research-v1/stages/bodyDerivedRole.ts";

describe("Hebrew legal-topic normalization", () => {
  const EQUIVALENT: [string, string][] = [
    ["מנהלית", "המנהלי"],
    ["מנהלי", "מנהליות"],
    ["מנהלית", "מנהלי"],
    ["הסתמכות", "ההסתמכות"],
    ["הסתמכות", "בהסתמכות"],
    ["הסתמכות", "להסתמכות"],
    ["מידתיות", "המידתיות"],
    ["מידתיות", "במידתיות"],
    ["מידתיות", "למידתיות"],
    ["סבירות", "הסבירות"],
    ["סבירות", "בסבירות"],
    ["ציפייה", "הציפייה"],
    ["ציפייה", "ציפיות"],
    ["הבטחה", "ההבטחה"],
    ["הבטחה", "הבטחות"],
    ["רשות", "הרשות"],
    ["רשות", "רשויות"],
    ["ביקורת", "הביקורת"],
    ["מינהל", "מנהל"],
    ["מינהלי", "מנהלית"],
    // additional legal vocabulary beyond the listed regression set
    ["חוקתיות", "החוקתית"],
    ["שיקול", "השיקול"],
    ["תקנה", "התקנות"],
    ["זכות", "הזכויות"],
    ["חובה", "חובות"],
    ["פרשנות", "הפרשנות"],
    ["שוויון", "השוויון"],
    ["הליך", "ההליכים"],
  ];

  for (const [a, b] of EQUIVALENT) {
    it(`matches ${a} ↔ ${b}`, () => {
      expect(termsMatch(a, b)).toBe(true);
      expect(termsMatch(b, a)).toBe(true);
    });
  }

  const DISTINCT: [string, string][] = [
    ["סבירות", "הסבר"],
    ["מידתיות", "מדינה"],
    ["הסתמכות", "השתתפות"],
    ["רשות", "ירושה"],
    ["מנהלי", "נהלים"],
    ["הבטחה", "בטיחות"],
    ["ציפייה", "צפייה בטלוויזיה"],
  ];
  for (const [a, b] of DISTINCT) {
    it(`does not collapse ${a} / ${b}`, () => {
      expect(termsMatch(a, b)).toBe(false);
    });
  }

  it("does not blindly strip a lexical leading mem", () => {
    // מנהלי keeps its surface form, so it still matches המנהלי.
    expect(termsMatch("מנהלית", "המנהלי")).toBe(true);
    expect(termsMatch("משפטים", "המשפטים")).toBe(true);
  });
});

describe("dynamic direct threshold", () => {
  it("scales with the question's own vocabulary", () => {
    expect(requiredDirectMatches(2)).toBe(2);
    expect(requiredDirectMatches(3)).toBe(2);
    expect(requiredDirectMatches(8, "body")).toBe(4);
    expect(requiredDirectMatches(3, "body")).toBe(2);
  });

  it("drops request verbs from question vocabulary", () => {
    const terms = subjectTerms("תעשה לי סקירת ספרות על עילת הסבירות").map((t) => t.word);
    expect(terms).not.toContain("תעשה");
    expect(terms).not.toContain("סקירת");
    expect(terms.join(" ")).toContain("סבירות");
  });

  it("classifies a short natural prompt's own doctrine article as direct", () => {
    const q = "תעשה לי סקירת ספרות על עילת הסבירות";
    const r = scoreLiteratureTopicality(q, {
      title: "על סבירותה של עילת הסבירות במשפט המנהלי",
      snippet: "מאמר על עילת אי-הסבירות",
      url: "https://law.tau.ac.il/article",
    });
    expect(r.direct).toBe(true);
    expect(r.core_topic_match).toBe(true);
    expect(r.required_matches).toBeLessThanOrEqual(3);
  });

  it("still rejects an unrelated source on the same short prompt", () => {
    const r = scoreLiteratureTopicality("תעשה לי סקירת ספרות על עילת הסבירות", {
      title: "חלוקת רכוש בין בני זוג בבית הדין הרבני",
      snippet: "איזון משאבים",
      url: "https://example.org/x",
    });
    expect(r.direct).toBe(false);
  });

  it("matches the audit regression: reliance article vs administrative prompt", () => {
    const q = "תעזור לי לבנות פרק סקירת ספרות על הסתמכות מול רשות מנהלית";
    const shared = sharedSubjectTerms(q, "הגנת ההסתמכות במשפט המנהלי");
    expect(shared.length).toBeGreaterThanOrEqual(2);
    expect(coreTopicTerms(q).length).toBeGreaterThan(0);
  });
});

describe("post-body topicality", () => {
  const q = "תכתוב לי סקירת ספרות לסמינריון על הבטחה מנהלית וציפייה לגיטימית";
  it("promotes a long on-topic body to direct", () => {
    const row = classifyBodyTopicality(q, {
      candidate_id: "c1",
      title: "הזוג המוזר: הבטחה מנהלית וחוזה רגולטורי",
      body: ("ההבטחה המנהלית והציפייה הלגיטימית ברשויות המנהליות. ".repeat(60)),
    }, "r");
    expect(row.role_after_body).toBe("direct");
    expect(row.topicality_threshold_decision.core_topic_match).toBe(true);
    expect(row.topicality_threshold_decision.new_required_matches).toBeLessThanOrEqual(4);
  });

  it("keeps an off-topic body out", () => {
    const row = classifyBodyTopicality(q, {
      candidate_id: "c2",
      title: "רגולציה של סייבר בארצות הברית",
      body: "cyber regulation in the united states ".repeat(80),
    }, "r");
    expect(row.role_after_body).toBe("off_topic");
    expect(row.eligible_for_pack).toBe(false);
  });
});

describe("body-derived role", () => {
  const article =
    "תקציר\nמאמר זה עוסק בעילת הסבירות. ראו לעיל, ה\"ש 12. ראו לעיל, ה\"ש 20. ראו לעיל, ה\"ש 33. " +
    "כתב העת עיוני משפט. ".repeat(200);
  const judgment =
    "בבית המשפט העליון בשבתו כבית משפט גבוה לצדק\nלפני: כב' השופט א' ברק\nהעותרים נגד המשיבים\n" +
    "פסק-דין\nניתן היום. ".repeat(40);
  const statute =
    "חוק יסוד: כבוד האדם וחירותו, התשנ\"ב-1992\nבחוק זה - \nפרק א': עקרונות. תיקון מס' 2. ".repeat(30);

  it("recognises a journal article discovered through a statute slot", () => {
    const out = relabelRoleAfterBody({
      candidate_id: "c1",
      title: "על סבירותה של עילת הסבירות",
      url: "https://law.tau.ac.il/iyunei-mishpat",
      role: "primary_statute",
      body: article,
      body_chars: article.length,
      can_satisfy_role_before: false,
    }, "r");
    expect(out.row.body_derived_role).toBe("journal_article");
    expect(out.new_role).toBe("scholarship");
    expect(out.can_satisfy_role_after).toBe(true);
    expect(out.row.role_changed).toBe(true);
  });

  it("keeps a judgment a judgment even on an academic host", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c2",
      title: "בג\"ץ 1234/20 פלוני נ' שר הפנים",
      url: "https://law.huji.ac.il/mirror",
      body: judgment,
    });
    expect(out.body_derived_role).toBe("binding_case_law");
  });

  it("relabels a statute found through a scholarship slot", () => {
    const out = relabelRoleAfterBody({
      candidate_id: "c3",
      title: "חוק יסוד: כבוד האדם וחירותו",
      url: "https://www.knesset.gov.il/laws",
      role: "scholarship",
      body: statute,
      body_chars: statute.length,
      can_satisfy_role_before: false,
    }, "r");
    expect(out.row.body_derived_role).toBe("primary_statute");
    expect(out.new_role).toBe("primary_statute");
  });

  it("never promotes a listing page", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c4",
      title: "תוצאות חיפוש",
      url: "https://example.org/search",
      body: "תוצאות חיפוש עבור עילת הסבירות",
    });
    expect(out.body_derived_role).toBe("listing_or_catalog");
  });

  it("does not override the slot without a body", () => {
    const out = relabelRoleAfterBody({
      candidate_id: "c5",
      title: "מאמר כלשהו",
      role: "primary_statute",
      body: "",
      body_chars: 0,
      can_satisfy_role_before: false,
    }, "r");
    expect(out.new_role).toBeNull();
    expect(out.row.reason).toBe("no_body_acquired_slot_role_kept");
  });

  it("marks scholarship direct when post-body topicality is direct", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c6",
      title: "עילת הסבירות",
      url: "https://law.tau.ac.il/x",
      body: article,
      body_topicality: "direct",
    });
    expect(out.body_derived_role).toBe("direct_scholarship");
  });
});

describe("document identity precedence", () => {
  const scholarlyQuotingJudgment =
    "הערות על ביקורת הסבירות במשפט המינהלי, עיוני משפט. תקציר\n" +
    "בבית המשפט העליון קבע כבוד השופט ברק כי... ראו לעיל, ה\"ש 4. ".repeat(80);

  it("keeps a journal article scholarship even when it quotes judgments", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c7",
      title: "הערות על ביקורת הסבירות במשפט המינהלי",
      url: "https://law.tau.ac.il/x",
      body: scholarlyQuotingJudgment,
    });
    expect(out.body_derived_role).toBe("journal_article");
  });

  it("still calls a titled statute a statute", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c8",
      title: "חוק יסוד: כבוד האדם וחירותו",
      url: "https://www.knesset.gov.il/laws",
      body: "בחוק זה - כבוד האדם וחירותו. ".repeat(60),
    });
    expect(out.body_derived_role).toBe("primary_statute");
  });

  it("calls titled regulations regulations", () => {
    const out = deriveRoleFromBody({
      candidate_id: "c9",
      title: "תקנות הגנת הפרטיות",
      body: "תקנות אלה יחולו. ".repeat(60),
    });
    expect(out.body_derived_role).toBe("regulation_or_guideline");
  });
});
