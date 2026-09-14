/**
 * judgment_self_identity_v1
 *
 * A fetched body may bind to a requested judgment authority key only when the
 * body IS that judgment: substantive judgment form (V1 classifier) plus
 * caption-local structural self-identification. Host/domain is never a signal.
 */
import { describe, expect, it } from "vitest";
import {
  corroborateAuthority,
} from "../../supabase/functions/legal-research-v2/tools/authorityCorroboration";
import { classifyLocalCaselawBody } from "../../supabase/functions/legal-research-v2/vendor/judgmentBodyForm";

const idf = { dockets: [] as string[], statutes: [] as string[], sections: [] as string[] };

function check(docket: string, title: string, text: string) {
  return corroborateAuthority({
    expected: { docket },
    title,
    text,
    identity_fields: idf,
    is_actual_document: true,
  });
}

const reasoning = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `\n${i + 1}. הנימוק המשפטי המפורט בסוגיה שלפנינו, ובחינת טענות הצדדים לגופן, לרבות ההלכה הפסוקה. `
      .repeat(3)).join("");

/** A genuine judgment reproduction: caption, parties, panel, body, closing. */
function genuineJudgment(opts: {
  docket: string;
  court?: string;
  parties?: string;
  closing?: boolean;
  paragraphs?: number;
}) {
  const court = opts.court ?? "בבית המשפט העליון בשבתו כבית משפט לערעורים אזרחיים";
  const parties = opts.parties ?? "המערער: פלוני\nנגד\nהמשיבה: אלמונית בע\"מ";
  return [
    court,
    opts.docket,
    "לפני כבוד השופט א' כהן",
    parties,
    "פסק דין",
    reasoning(opts.paragraphs ?? 14),
    opts.closing === false ? "" : "\nאשר על כן, הערעור נדחה.\nניתן היום, כ' בטבת התשפ\"ה.",
  ].join("\n");
}

describe("must reject — commentary, summaries and wrong-identity pages", () => {
  it("Globes article discussing ע\"א 2553/01", () => {
    const text = [
      "גלובס | משפט",
      "מאת כתב גלובס | עודכן היום",
      "כתבה: בית המשפט העליון קבע הלכה חדשה בסוגיית האחריות.",
      "בפסק הדין ע\"א 2553/01 נקבע כי יש לבחון את נסיבות המקרה.",
      "כתבות נוספות בנושא. תגיות: משפט. שתפו.",
      "ניתוח: משמעות ההחלטה עבור השוק. ".repeat(300),
    ].join("\n");
    const r = check('ע"א 2553/01', "גלובס - הלכה חדשה בעליון", text);
    expect(r.corroborated).toBe(false);
    expect(["docket_mention_not_self_identifying", "judgment_body_form_absent"]).toContain(r.basis);
  });

  it("Psakdin תקציר summary for ע\"א 3807/12", () => {
    const text = [
      "תקציר פסק דין",
      "ע\"א 3807/12 - בית המשפט העליון",
      "המערער נ' המשיב",
      "עיקרי ההחלטה: בית המשפט דחה את הערעור. ".repeat(15),
    ].join("\n");
    const r = check('ע"א 3807/12', "פסק דין - תקציר", text);
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("judgment_body_form_absent");
  });

  it("Immunewill article discussing ע\"א 5185/93", () => {
    const text = "ייעוץ משפטי בענייני צוואות וירושות. ".repeat(200) +
      "\nבבית המשפט העליון בע\"א 5185/93 נדונה שאלת כשרות הצוואה, ובפסק הדין נקבע כי המערער לא עמד בנטל.\n" +
      "צרו קשר לייעוץ. כתבות נוספות. ".repeat(200);
    const r = check('ע"א 5185/93', "כשרות צוואה - מאמר", text);
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_mention_not_self_identifying");
  });

  it("wrong-court חיפה 2553-01", () => {
    const r = check(
      'ע"א 2553/01',
      "בית המשפט המחוזי בחיפה",
      genuineJudgment({
        docket: "ע\"א (מחוזי חיפה) 2553/01",
        court: "בית המשפט המחוזי בחיפה",
      }),
    );
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_court_level_mismatch");
  });

  it("wrong-court באר שבע 8704-09 (wrong proceeding type)", () => {
    const r = check(
      'ע"פ 8704/09',
      "בית משפט השלום בבאר שבע",
      genuineJudgment({
        docket: "ת\"א 8704/09",
        court: "בית משפט השלום בבאר שבע",
      }),
    );
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_proceeding_type_mismatch");
  });

  it("unrelated article citing a docket in passing", () => {
    const text = "סקירת שוק ההון השבועית. ".repeat(400) +
      "\nיש שיזכירו את ע\"א 423/75, אך הדיון כאן כלכלי.\n" +
      "המשך הסקירה. ".repeat(300);
    const r = check('ע"א 423/75', "סקירה כלכלית", text);
    expect(r.corroborated).toBe(false);
  });
});

describe("must accept — genuine judgment bodies from any host", () => {
  it("court.gov.il full judgment", () => {
    const r = check('ע"פ 8704/09', "HebrewVerdicts", genuineJudgment({ docket: "ע\"פ 8704/09" }));
    expect(r.corroborated).toBe(true);
    expect(r.basis).toBe("docket_present_in_body");
  });

  it("judgments.org.il full body 423/75", () => {
    const r = check('ע"א 423/75', "עא 423/75", genuineJudgment({ docket: "ע\"א 423/75" }));
    expect(r.corroborated).toBe(true);
  });

  it("judgments.org.il full body 417/81", () => {
    const r = check('ע"א 417/81', "עא 417/81", genuineJudgment({ docket: "ע\"א 417/81" }));
    expect(r.corroborated).toBe(true);
  });

  it("old-format historical judgment without numbered paragraphs", () => {
    const body = [
      "בבית המשפט העליון בשבתו כבית משפט לערעורים אזרחיים",
      "ע\"א 423/75",
      "לפני כבוד השופט זוסמן",
      "המערער נגד המשיב",
      "פסק דין",
      "השופט זוסמן: בערעור זה עלינו להכריע בשאלת פרשנות ההסכם. ".repeat(80),
    ].join("\n");
    const r = check('ע"א 423/75', "פסק דין ישן", body);
    expect(r.corroborated).toBe(true);
  });

  it("genuine judgment whose party names are unknown to the request", () => {
    const r = check(
      'ע"א 417/81',
      "",
      genuineJudgment({ docket: "ע\"א 417/81", parties: "המערערת: חברה א\nנגד\nהמשיב: פלוני" }),
    );
    expect(r.corroborated).toBe(true);
  });

  it("short but structurally genuine judgment with no closing disposition", () => {
    const r = check(
      'ע"א 417/81',
      "",
      genuineJudgment({ docket: "ע\"א 417/81", closing: false, paragraphs: 10 }),
    );
    expect(r.corroborated).toBe(true);
  });
});

describe("ported V1 classifier keeps its behaviour", () => {
  it("classifies listing bodies, summaries and stubs as before", () => {
    const listing = "תוצאות חיפוש לצפייה לצפייה לצפייה עמוד הבא תוצאות נוספות ";
    expect(
      classifyLocalCaselawBody({
        title: "ארכיון",
        text: listing.repeat(20),
        case_number: null,
        body_chars: 4000,
      }).classification,
    ).toBe("listing_or_index_body");
    expect(
      classifyLocalCaselawBody({
        title: "תקציר פסק דין",
        text: `תקציר פסק דין\nלפני כבוד השופטת פלונית\nהחלטה ${"ב".repeat(1200)}`,
        case_number: "9/24",
        body_chars: 1300,
      }).classification,
    ).toBe("partial_judgment_summary");
    expect(
      classifyLocalCaselawBody({
        title: "כותרת",
        text: "ביהמ\"ש לענייני משפחה: פס\"ד תביעה",
        case_number: null,
        body_chars: 214,
      }).classification,
    ).toBe("metadata_only");
  });
});

describe("regression — unrelated corroboration paths unchanged", () => {
  const STATUTE = 'חוק ההסדרה הכללית, התשל"ג-1973';
  it("statute corroboration is unaffected", () => {
    const r = corroborateAuthority({
      expected: { statute: STATUTE },
      title: STATUTE,
      text: `${STATUTE}\n1. הוראות כלליות.\n8. הסדר האיזון.`,
      identity_fields: { dockets: [], statutes: [STATUTE], sections: [] },
      is_actual_document: true,
    });
    expect(r.corroborated).toBe(true);
    expect(r.basis).toBe("statute_title_present_in_body");
  });

  it("no_expected_identity unchanged", () => {
    const r = corroborateAuthority({
      expected: undefined,
      title: "x",
      text: "y",
      identity_fields: idf,
      is_actual_document: true,
    });
    expect(r.basis).toBe("no_expected_identity");
  });

  it("body_not_a_document unchanged", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 423/75' },
      title: "x",
      text: "y",
      identity_fields: idf,
      is_actual_document: false,
    });
    expect(r.basis).toBe("body_not_a_document");
  });
});
