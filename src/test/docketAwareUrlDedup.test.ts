import { describe, it, expect } from "vitest";
import {
  buildUrlDedupeKey,
  detectTitleDocket,
} from "../../supabase/functions/legal-research-v1/stages/docketAwareUrlKey.ts";

describe("docket_aware_url_dedup_v1", () => {
  it("keeps distinct Supreme Court download URLs distinct", () => {
    const a = buildUrlDedupeKey(
      "https://supremedecisions.court.gov.il/Home/Download?fileName=03086380_A11.txt&path=HebrewVerdicts/03/380/086/A11&type=2",
      'בג"ץ 8638/03 סימה אמיר',
    );
    const b = buildUrlDedupeKey(
      "https://supremedecisions.court.gov.il/Home/Download?fileName=93010000_Z01.txt&path=HebrewVerdicts/92/000/100/Z01&type=2",
      'בג"ץ 1000/92 בבלי',
    );
    expect(a.identity_source).toBe("query_param");
    expect(a.dedupe_identity_params_used ?? a.identity_params_used).toContain("filename");
    expect(a.key).not.toBe(b.key);
    expect(a.normalized_url_old).toBe(b.normalized_url_old);
  });

  it("collapses the same document reached via identical identity params", () => {
    const u = "https://supremedecisions.court.gov.il/Home/Download?fileName=03086380_A11.txt&path=HebrewVerdicts/03/380/086/A11&type=2";
    expect(buildUrlDedupeKey(u).key).toBe(buildUrlDedupeKey(u + "&extra=1").key);
  });

  it("falls back to the title docket on a generic download endpoint", () => {
    const a = buildUrlDedupeKey("https://www.gov.il/BlobFolder/dynamiccollectors/spokmanship_court", 'בג"ץ 8638/03 סימה אמיר');
    const b = buildUrlDedupeKey("https://www.gov.il/BlobFolder/dynamiccollectors/spokmanship_court", 'בג"ץ 1000/92 בבלי');
    expect(a.identity_source).toBe("title_docket");
    expect(a.key).not.toBe(b.key);
  });

  it("leaves ordinary pages on the legacy host+path key", () => {
    for (const u of [
      "https://www.lawfirm.co.il/articles/property-division?utm_source=x",
      "https://www.ynet.co.il/news/article/12345",
      "https://someblog.com/post/1?ref=twitter",
      "https://example.com/files/report.pdf?id=7",
    ]) {
      const r = buildUrlDedupeKey(u, 'בג"ץ 8638/03');
      expect(r.identity_source).toBe("normal_url");
      expect(r.key).toBe(r.normalized_url_old);
    }
  });

  it("detects dockets in titles, tolerating quote variants and dashes", () => {
    expect(detectTitleDocket('בג"ץ 8638/03 סימה אמיר')).toBe(detectTitleDocket("בג״ץ 8638-03 - סימה אמיר"));
    expect(detectTitleDocket("מאמר על חלוקת רכוש")).toBeNull();
  });
});
