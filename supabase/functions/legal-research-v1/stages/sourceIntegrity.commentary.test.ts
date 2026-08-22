import { describe, expect, it } from "vitest";
import { classifySourceIntegrity } from "./sourceIntegrity.ts";

describe("commentary_vs_judgment_classification_v1", () => {
  it("keeps a real Supreme Court judgment endpoint as a judgment", () => {
    const r = classifySourceIntegrity({
      url: "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts/23/130/039/x11&fileName=23039130.x11&type=4&caseId=1234567",
      title: 'בג"ץ 1234/23 פלוני נ\' היועצת המשפטית לממשלה',
      snippet: 'בבית המשפט העליון בשבתו כבית משפט גבוה לצדק. אשר על כן, העתירה נדחית. ניתן היום.',
      source_type: "caselaw",
    });
    expect(r.citable_as).toBe("judgment");
    expect(r.judgment_identity_signals).toContain("official_judgment_endpoint");
  });

  it("downgrades an article analysing a judgment to commentary", () => {
    const r = classifySourceIntegrity({
      url: "https://www.idi.org.il/articles/12345",
      title: 'בעקבות בג"ץ 5555/18 חסון נ\' כנסת ישראל — ניתוח פסק הדין',
      snippet: 'במאמר זה נבחן את פסק הדין של בית המשפט העליון וקביעותיו.',
      source_type: "caselaw",
    });
    expect(r.citable_as).not.toBe("judgment");
    expect(r.is_judgment_document).toBe(false);
    expect(r.commentary_identity_signals?.length).toBeGreaterThan(0);
    expect(r.has_holding_text).toBe(false);
  });

  it("does not turn a news page into a judgment on docket mention alone", () => {
    const r = classifySourceIntegrity({
      url: "https://www.ynet.co.il/news/article/abc123",
      title: 'בג"ץ 7052/03 עדאלה נ\' שר הפנים — מה נקבע',
      snippet: 'בית המשפט העליון קבע כי העתירה מתקבלת.',
      source_type: "news",
    });
    expect(r.citable_as).toBe("commentary");
    expect(r.commentary_identity_signals).toContain("commentary_host");
  });

  it("keeps a nevo judgment PDF with docket as a judgment", () => {
    const r = classifySourceIntegrity({
      url: "https://www.nevo.co.il/psakdin/123456.pdf",
      title: 'ע"א 6821/93 בנק המזרחי נ\' מגדל כפר שיתופי',
      snippet: 'בבית המשפט העליון. כב\' השופט ברק. אשר על כן, הערעור נדחה.',
      source_type: "caselaw",
    });
    expect(r.citable_as).toBe("judgment");
  });

  it("flags scholarship repositories as commentary identity", () => {
    const r = classifySourceIntegrity({
      url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4455667",
      title: 'עיונים בעקבות הלכת בנק המזרחי',
      snippet: 'מאמר אקדמי הבוחן את פסק הדין.',
      source_type: "journal_article",
    });
    expect(r.citable_as).not.toBe("judgment");
  });
});
