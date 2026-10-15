import { describe, it, expect } from "vitest";
import {
  extractDocket,
  parseDocketNumber,
  urlContainsDocket,
  urlContainsDocketVia,
  textContainsDocket,
  anyUrlContainsDocket,
  docketPatternSource,
  isThreePartDocket,
} from "../../supabase/functions/_shared/trustedHosts.ts";
import { CASE_DOCKET_RE, findBareDocket } from "../../supabase/functions/_shared/caseTypePrefixes.ts";

const A = extractDocket("ת״א 1477-12-22")!;

describe("three-part docket identity", () => {
  it("reproducer keeps all three segments", () => {
    expect(A).toEqual({ full: "1477-12-22", num: "1477", year: "22", month: "12" });
    expect(isThreePartDocket(A)).toBe(true);
  });

  it("prefixed and bare three-part produce identical anchors", () => {
    const m = 'עש"א 1477-12-22 הוצאת הקיבוץ המאוחד'.match(CASE_DOCKET_RE)!;
    expect(extractDocket(`${m[1]} ${m[2]}`)).toEqual(A);
    const bare = findBareDocket("1477-12-22 הוצאת הקיבוץ המאוחד")!;
    expect(bare.docket).toBe("1477-12-22");
    expect(extractDocket(` ${bare.docket}`) ?? parseDocketNumber(bare.docket)).toEqual(A);
  });

  it("never collides with neighbours or the Supreme two-part 1477/12", () => {
    const B = parseDocketNumber("1477-12-23")!;
    const C = parseDocketNumber("1477-11-22")!;
    const S = extractDocket('ע"א 1477/12')!;
    const docs = { A, B, C, S };
    const texts: Record<string, string> = {
      A: "פסק דין ת״א 1477-12-22 פלוני",
      B: "פסק דין ת״א 1477-12-23 פלוני",
      C: "פסק דין ת״א 1477-11-22 פלוני",
      S: 'ע"א 1477/12 פלוני',
    };
    for (const [k, d] of Object.entries(docs)) {
      for (const [tk, t] of Object.entries(texts)) {
        expect(textContainsDocket(t, d)).toBe(k === tk);
        expect(urlContainsDocket(`https://www.nevo.co.il/x/${t.match(/\d+[-/]\d+(?:-\d+)?/)![0]}/`, d)).toBe(k === tk);
      }
    }
  });

  it("accepts separators, whitespace, en-dash, underscore and percent encoding", () => {
    for (const t of ["1477 - 12 - 22", "1477–12–22", "1477_12_22", "1477/12/22", "1477-12-2022", "1477-012-22"]) {
      expect(textContainsDocket(`x ${t} y`, A)).toBe(true);
    }
    expect(urlContainsDocket("https://www.nevo.co.il/a?d=1477%2D12%2D22", A)).toBe(true);
    expect(urlContainsDocket("https://www.nevo.co.il/a?d=1477%2F12%2F22", A)).toBe(true);
    expect(urlContainsDocket("https://www.nevo.co.il/a?d=1477%2F12%2F22&bad=%E0%A4%A", A)).toBe(true);
    expect(parseDocketNumber("1477 – 2 – 2022")).toEqual({ full: "1477-02-2022", num: "1477", year: "2022", month: "02" });
  });

  it("rejects invalid month/year and malformed input without partial fallback", () => {
    for (const s of ["ת״א 1477-00-22", "ת״א 1477-13-22", "ת״א 1477-12-223", "ת״א 1477-12-2", "ת״א 1477-12-22-5", "ת״א 1477/12345"]) {
      expect(extractDocket(s)).toBeNull();
    }
    for (const s of ["1477-00-22", "1477-13-22", "1477-12-223", "1477-12-22x"]) {
      expect(parseDocketNumber(s)).toBeNull();
    }
  });

  it("matches complete tokens only", () => {
    for (const t of ["11477-12-22", "1477-12-221", "1477-12-22-3", "9-1477-12-22"]) {
      expect(textContainsDocket(t, A)).toBe(false);
    }
    const S = extractDocket('ע"א 1477/12')!;
    expect(textContainsDocket("1477-12-22", S)).toBe(false);
    expect(textContainsDocket("51477/12", S)).toBe(false);
  });

  it("three-part never satisfies Supreme encodings", () => {
    const fake = { full: "8987-01-22", num: "8987", year: "22", month: "01" };
    const url = "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F22%2F870%2F089%2FE07&fileName=22089870.E07&type=2";
    expect(urlContainsDocketVia(url, fake)).toEqual({ ok: false, via: "none" });
    expect(urlContainsDocketVia(url, { num: "8987", year: "22" }).ok).toBe(true);
  });

  it("opaque trusted URL needs exact snippet; caption pattern is three-part aware", () => {
    expect(anyUrlContainsDocket(["https://www.nevo.co.il/psika_html/mehozi/ME-22-12-1477-55.htm"], A)).toBe(false);
    expect(textContainsDocket('עש"א 1477-12-22 הוצאת הקיבוץ המאוחד בע"מ נ\' מדינת ישראל', A)).toBe(true);
    const cap = new RegExp(`${docketPatternSource(A)}\\s+(\\S+)`);
    expect("1477-12-22 הוצאת".match(cap)?.[1]).toBe("הוצאת");
    expect("1477-12-23 הוצאת".match(cap)).toBeNull();
  });

  it("two-part behaviour preserved", () => {
    const d = extractDocket('בג"ץ 4769/24')!;
    expect(d).toEqual({ full: "4769/24", num: "4769", year: "24" });
    expect(textContainsDocket("בג\"ץ 4769/2024", d)).toBe(true);
    expect(urlContainsDocket("https://www.nevo.co.il/case/123/4769/24", d)).toBe(true);
    expect(findBareDocket("פס' 4-6 לפסק הדין")).toBeNull();
  });
});
