import { describe, it, expect } from "vitest";
import { detectPrimaryAuthorityShape } from "../../supabase/functions/legal-research-v1/stages/primaryShapeRescue";

describe("class_unknown_primary_shape_rescue_v1", () => {
  it("rescues a judgment-shaped title", () => {
    const r = detectPrimaryAuthorityShape({
      url: "https://example.co.il/docs/8638-03.pdf",
      title: 'בג"ץ 8638/03 סימה אמיר נ\' בית הדין הרבני הגדול',
    });
    expect(r?.rescued).toBe(true);
    expect(r?.matched_docket).toBe("8638/03");
    expect(r?.rescued_as).toBe("judgment");
    expect(r?.original_classification).toBe("unknown");
  });

  it("rescues from a docket-bearing URL", () => {
    const r = detectPrimaryAuthorityShape({
      url: "https://files.example.org/%D7%91%D7%92%22%D7%A5%201000-92.pdf",
      title: "פסק דין",
    });
    expect(r?.matched_in).toBe("url");
  });

  it("does not rescue a commentary/blog page mentioning a docket", () => {
    expect(
      detectPrimaryAuthorityShape({
        url: "https://lawoffice.example.com/blog/property-division",
        title: 'מאמר: מה קובע בג"ץ 8638/03 על חלוקת רכוש?',
      }),
    ).toBeNull();
  });

  it("does not rescue on a snippet-only docket mention", () => {
    expect(
      detectPrimaryAuthorityShape({
        url: "https://example.com/x",
        title: "הלכת השיתוף בפסיקה",
        snippet: 'ראו בג"ץ 8638/03',
      }),
    ).toBeNull();
  });

  it("does not rescue an arbitrary numbered PDF", () => {
    expect(
      detectPrimaryAuthorityShape({
        url: "https://example.com/files/2019/12-2019.pdf",
        title: "דוח שנתי 12/2019",
      }),
    ).toBeNull();
  });
});
