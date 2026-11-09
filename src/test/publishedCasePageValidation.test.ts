/** The local checker reads the first page of פ"ד citations with and without a volume part. */
import { describe, expect, it } from "vitest";
import { validateAIResponse } from "@/lib/citationValidation";


describe("פ\"ד first page", () => {
  it("early volumes without a part (פ\"ד ז 871) are not reported as missing the first page", () => {
    const r = validateAIResponse("בג\"ץ 73/53 **חברת \"קול העם\" בע\"מ** נ' **שר הפנים**, פ\"ד ז 871 (1953).", "case_law_published");
    expect(r.missingFields).not.toContain("firstPage");
  });
  it("modern volumes with a part (פ\"ד סד(3) 202) still read the first page", () => {
    const r = validateAIResponse("ע\"א 1234/05 **פלוני** נ' **אלמוני**, פ\"ד סד(3) 202 (2010).", "case_law_published");
    expect(r.missingFields).not.toContain("firstPage");
  });
  it("a citation without any page is still reported as missing the first page", () => {
    const r = validateAIResponse("בג\"ץ 73/53 **חברת \"קול העם\" בע\"מ** נ' **שר הפנים**, פ\"ד ז (1953).", "case_law_published");
    expect(r.missingFields).toContain("firstPage");
  });
});
