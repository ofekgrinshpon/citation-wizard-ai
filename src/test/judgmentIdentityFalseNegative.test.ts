/**
 * judgment_identity_false_negative_fix_v1
 *
 * Genuine judgments from courts the V1 classifier never covered (labour
 * courts), old-format bodies and flattened PDF extractions must be able to
 * bind. Articles, summaries, listings, header cards and wrong-identity
 * judgments must still be refused. Nothing here relaxes the invariant that the
 * BODY has to corroborate the requested authority.
 */
import { describe, expect, it } from "vitest";
import { corroborateAuthority } from "../../supabase/functions/legal-research-v2/tools/authorityCorroboration";
import { detectDockets } from "../../supabase/functions/legal-research-v2/vendor/docketDetection";
import { classifyLocalCaselawBody } from "../../supabase/functions/legal-research-v2/vendor/judgmentBodyForm";

const idf = { dockets: [] as string[], statutes: [] as string[], sections: [] as string[] };

function check(
  docket: string,
  title: string,
  text: string,
  structured_docket?: string | null,
) {
  return corroborateAuthority({
    expected: { docket },
    title,
    text,
    identity_fields: idf,
    is_actual_document: true,
    structured_docket,
  });
}

const reasoning = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `\n${i + 1}. הנימוק המשפטי המפורט בסוגיה שלפנינו, ובחינת טענות הצדדים לגופן, לרבות ההלכה הפסוקה. `
      .repeat(3)).join("");

function labourJudgment(opts: { docket: string; court?: string; roles?: string }) {
  return [
    opts.court ?? "בית הדין הארצי לעבודה",
    opts.docket,
    "לפני כבוד השופטת ו' וירט-ליבנה",
    opts.roles ?? "המערער: העובד פלוני\nנגד\nהמשיבה: המעסיקה בע\"מ",
    "פסק דין",
    reasoning(14),
    "\nאשר על כן, הערעור נדחה.\nניתן היום, כ\"ב בשבט התשע\"א.",
  ].join("\n");
}

describe("proceeding-type coverage", () => {
  it("recognizes labour-court dockets that were previously unknown", () => {
    for (const raw of ['ע"ע 478/09', 'עב"ל 1381/01', 'ס"ק 30029/11', 'סע"ש 12345/17']) {
      expect(detectDockets(raw).length, raw).toBeGreaterThan(0);
    }
  });

  it("classifies a labour-court judgment as a substantive judgment body", () => {
    const text = labourJudgment({ docket: 'ע"ע 478/09' });
    expect(
      classifyLocalCaselawBody({
        title: "",
        text,
        case_number: null,
        body_chars: text.length,
      }).classification,
    ).toBe("substantive_judgment_body");
  });
});

describe("must accept — genuine judgment bodies", () => {
  it('Labour Court judgment with a ע"ע caption (Q28 shape)', () => {
    const r = check('ע"ע 478/09', 'ע"ע 478/09', labourJudgment({ docket: 'ע"ע 478/09' }));
    expect(r.corroborated).toBe(true);
    expect(r.basis).toBe("docket_present_in_body");
  });

  it("Labour Court judgment written as בית הדין הארצי לעבודה with a court descriptor", () => {
    const r = check(
      'ע"ע 478/09',
      "",
      labourJudgment({ docket: 'ע"ע (ארצי) 478/09', court: "בבית הדין הארצי לעבודה בירושלים" }),
    );
    expect(r.corroborated).toBe(true);
  });

  it("regional labour court judgment requested with its own qualifier", () => {
    const r = check(
      'סע"ש (תל אביב) 12345/17',
      "",
      labourJudgment({
        docket: 'סע"ש (תל אביב) 12345/17',
        court: "בית הדין האזורי לעבודה בתל אביב",
      }),
    );
    expect(r.corroborated).toBe(true);
  });

  it("old-format judgment with no proceeding token next to the number", () => {
    const body = [
      "בבית המשפט העליון בשבתו כבית משפט לערעורים אזרחיים",
      "תיק 135/75",
      "לפני כבוד השופט זוסמן",
      "המערערת נגד המשיב",
      "פסק דין",
      "השופט זוסמן: בערעור זה עלינו להכריע בשאלת פרשנות ההסכם. ".repeat(80),
    ].join("\n");
    const r = check('ע"א 135/75', "", body);
    expect(r.corroborated).toBe(true);
  });

  it("flattened PDF extraction whose caption survived as one long line", () => {
    const flat =
      `בבית המשפט העליון בשבתו כבית משפט גבוה לצדק בג"ץ 2098/97 העותרת: פלונית נגד המשיב: שר הפנים לפני כבוד הנשיא א' ברק, כבוד השופט ת' אור וכבוד השופטת ד' דורנר פסק דין`;
    const text = `${flat}\n${reasoning(16)}\nאשר על כן, העתירה נדחתה.\nניתן היום.`;
    const r = check('בג"ץ 2098/97', "", text);
    expect(r.corroborated).toBe(true);
    expect(r.detail).toContain("flattened_caption");
  });

  it("stored exact case_number rescues a judgment whose docket line was lost in extraction", () => {
    const body = [
      "בבית המשפט העליון בשבתו כבית משפט לערעורים אזרחיים",
      "לפני כבוד השופט א' ברק",
      "המערער: פלוני",
      "נגד",
      "המשיבה: אלמונית בע\"מ",
      "פסק דין",
      reasoning(16),
      "אשר על כן, הערעור נדחה.",
    ].join("\n");
    const r = check('ע"א 4855/02', "", body, "4855/02");
    expect(r.corroborated).toBe(true);
    expect(r.basis).toBe("structured_docket_metadata_corroborated");
  });
});

describe("must reject — metadata may never promote a non-judgment", () => {
  it("stored case_number plus an article body does not bind", () => {
    const article = "סקירה משפטית על אחריות מעסיקים. ".repeat(300);
    const r = check('ע"א 4855/02', "מאמר", article, "4855/02");
    expect(r.corroborated).toBe(false);
  });

  it("stored case_number plus a summary page does not bind", () => {
    const summary = [
      "תקציר פסק דין",
      "המערער נ' המשיב",
      "עיקרי ההחלטה: הערעור נדחה. ".repeat(20),
    ].join("\n");
    const r = check('ע"א 4855/02', "תקציר", summary, "4855/02");
    expect(r.corroborated).toBe(false);
  });

  it("stored case_number does not bind when the head names a different case", () => {
    const body = [
      "בבית המשפט העליון",
      "ע\"א 9999/11",
      "לפני כבוד השופט א' ברק",
      "המערער נגד המשיב",
      "פסק דין",
      reasoning(16),
    ].join("\n");
    const r = check('ע"א 4855/02', "", body, "4855/02");
    expect(r.corroborated).toBe(false);
  });

  it("a mismatched stored case_number is ignored entirely", () => {
    const r = check('ע"א 4855/02', "", labourJudgment({ docket: "" }), "1234/99");
    expect(r.corroborated).toBe(false);
  });
});

describe("must reject — contradiction still wins", () => {
  it("different proceeding type with the same number", () => {
    const r = check('ע"ע 478/09', "", labourJudgment({ docket: 'עב"ל 478/09' }));
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_proceeding_type_mismatch");
  });

  it("different court level with the same number", () => {
    const r = check(
      'ע"ע 478/09',
      "",
      labourJudgment({
        docket: 'ע"ע 478/09',
        court: "בית הדין האזורי לעבודה בחיפה — המחוזי",
      }).replace('ע"ע 478/09', 'בית הדין האזורי לעבודה בחיפה ע"ע 478/09'),
    );
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_court_level_mismatch");
  });

  it("a judgment that merely cites the requested case in its reasoning", () => {
    const other = labourJudgment({ docket: 'ע"ע 900/15' }) +
      "\nוראו את שנפסק בע\"ע 478/09, שם נקבע כי יש לבחון את נסיבות ההעסקה.\n" +
      "המשך הנמקה. ".repeat(200);
    const r = check('ע"ע 478/09', "", other);
    expect(r.corroborated).toBe(false);
  });

  it("law-firm commentary containing the docket", () => {
    const text = "משרדנו מתמחה בדיני עבודה. ".repeat(200) +
      "\nבבית הדין הארצי לעבודה, ע\"ע 478/09, נדונה שאלת פיטורי עובד, ונקבע כי המערער לא עמד בנטל.\n" +
      "צרו קשר. מאמרים נוספים. ".repeat(200);
    const r = check('ע"ע 478/09', "פיטורים - מאמר", text);
    expect(r.corroborated).toBe(false);
  });

  it("search/listing page mentioning the docket", () => {
    const text = [
      "תוצאות חיפוש",
      'ע"ע 478/09 לצפייה',
      "עמוד הבא | עמוד קודם | הצג עוד | סנן | תוצאות נוספות",
      "לצפייה לצפייה לצפייה ".repeat(60),
    ].join("\n");
    const r = check('ע"ע 478/09', "מאגר פסיקה", text);
    expect(r.corroborated).toBe(false);
  });

  it("newsletter header card that is not the judgment body", () => {
    const text = [
      'ע"ע 478/09 - עדכון פסיקה',
      "מאת מחלקת דיני עבודה | ניוזלטר לקוחות",
      "בית הדין הארצי לעבודה דחה את הערעור.",
      "להרשמה לניוזלטר | כל הזכויות שמורות | צור קשר",
      "עדכוני פסיקה נוספים בתחום דיני העבודה והעסקת עובדים זרים. ".repeat(60),
    ].join("\n");
    const r = check('ע"ע 478/09', "", text);
    expect(r.corroborated).toBe(false);
  });

  it("metadata-only stub", () => {
    const r = check('ע"ע 478/09', 'ע"ע 478/09', "פרטי ההליך: בית הדין הארצי לעבודה. סטטוס: סגור.");
    expect(r.corroborated).toBe(false);
  });
});
