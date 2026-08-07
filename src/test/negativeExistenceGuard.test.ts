// Guardrail: no_negative_doctrine_existence_from_retrieval_failure_v1
//
// Retrieval failure must never be rendered as a legal finding of
// non-existence. Every forbidden phrasing must be rewritten into a
// source-scoped statement.

import { describe, expect, it } from "vitest";
import { scrubNegativeExistenceClaims } from "../../supabase/functions/legal-research-v1/stages/negativeExistenceGuard.ts";

const FORBIDDEN = [
  "אינה קיימת",
  "איננה קיימת",
  "אין הלכה מוכרת",
  "לא קיימת הלכה כזו",
  "לא נמצאה הלכה מוכרת",
];

function assertClean(text: string) {
  const { text: out } = scrubNegativeExistenceClaims(text);
  for (const f of FORBIDDEN) expect(out).not.toContain(f);
  return out;
}

describe("negative existence guard", () => {
  it("rewrites the G15 opener without asserting non-existence", () => {
    const g15 =
      'לא נמצאה הלכה מוכרת בשם "דוקטרינת השיתוף הספציפי בדירת מגורים". במקום זאת, במקורות שסופקו נדון מוסד מעשי.';
    const out = assertClean(g15);
    expect(out).toContain("במקורות שאותרו לא נמצא עיגון מספק");
  });

  it("rewrites bare non-existence assertions", () => {
    assertClean("אין הלכה מוכרת בנושא זה.");
    assertClean("הדוקטרינה אינה קיימת בדין הישראלי.");
    assertClean("לא קיימת הלכה כזו.");
    assertClean("הדוקטרינה אינה מוכרת בפסיקה הישראלית.");
  });

  it("leaves source-scoped phrasing untouched", () => {
    const safe =
      "במקורות שאותרו לא נמצא עיגון מספק לדוקטרינה; ייתכן שקיימת פסיקה שלא אותרה בחיפוש זה.";
    const res = scrubNegativeExistenceClaims(safe);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(safe);
  });

  it("does not touch unrelated legal prose or citations", () => {
    const prose =
      "בית המשפט קבע כי תנאי מגביל בחוזה אחיד עשוי להיות בטל.¹ ראו ע\"א 6821/93.";
    expect(scrubNegativeExistenceClaims(prose).text).toBe(prose);
  });
});
