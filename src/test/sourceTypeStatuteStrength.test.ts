import { describe, expect, it } from "vitest";
import { detectSourceType, hasStrongStatuteSignal, looksLikeLiteratureShape } from "@/data/abbreviations";
import { isWeakLegislationGuess, shouldUseLLMClassifier } from "@/lib/sourceTypeClassifier";

const LITERATURE = [
  "אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים",
  "דניאל פרידמן נער לפי שנות החקיקה הישראלית החדשה",
  "אהרן ברק פרשנות במשפט",
  "ברק מדינה דיני זכויות האדם בישראל",
  "יצחק זמיר הסמכות המינהלית",
];

const LEGISLATION: Array<[string, string]> = [
  ["חוק הלאום", "primary_legislation"],
  ["חוק יסוד הלאום", "basic_law"],
  ["חוק יסוד ישראל מדינת הלאום", "basic_law"],
  ["חוק-יסוד: ישראל — מדינת הלאום של העם היהודי", "basic_law"],
  ["חוק יסוד כבוד האדם וחירותו", "basic_law"],
  ["חוק-יסוד: כבוד האדם וחירותו", "basic_law"],
  ["חוק החוזים", "primary_legislation"],
  ["חוק החוזים (חלק כללי)", "primary_legislation"],
  ['חוק החוזים (חלק כללי), התשל"ג-1973', "primary_legislation"],
  ["פקודת הנזיקין", "primary_legislation"],
  ["פקודת הנזיקין [נוסח חדש]", "primary_legislation"],
  ["תקנות סדר הדין האזרחי", "secondary_legislation"],
];

describe("statute signal strength", () => {
  it.each(LITERATURE)("literature shape: %s", (input) => {
    expect(looksLikeLiteratureShape(input)).toBe(true);
    expect(hasStrongStatuteSignal(input)).toBe(false);
    expect(detectSourceType(input)).not.toBe("primary_legislation");
    expect(detectSourceType(input)).not.toBe("basic_law");
    expect(detectSourceType(input)).not.toBe("secondary_legislation");
    // weak/ambiguous → must reach the LLM classifier
    expect(shouldUseLLMClassifier(input, detectSourceType(input))).toBe(true);
  });

  it.each(LEGISLATION)("legislation: %s → %s", (input, expected) => {
    expect(hasStrongStatuteSignal(input)).toBe(true);
    expect(detectSourceType(input)).toBe(expected);
    expect(isWeakLegislationGuess(input, detectSourceType(input))).toBe(false);
    // strong statute match → never sent to the LLM for override
    expect(shouldUseLLMClassifier(input, detectSourceType(input))).toBe(false);
  });

  it("keeps case-law detection intact", () => {
    expect(detectSourceType("בג\"ץ 5555/18 חסון נ' כנסת ישראל")).toBe("case_law_database");
    expect(detectSourceType("ע\"א 1234/56 פלוני נ' אלמוני, פ\"ד נד(1) 1")).toBe("case_law_published");
  });
});
