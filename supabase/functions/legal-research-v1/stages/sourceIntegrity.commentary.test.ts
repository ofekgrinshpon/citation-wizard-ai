// commentary_vs_judgment_classification_v1 tests.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifySourceIntegrity } from "./sourceIntegrity.ts";

Deno.test("real Supreme Court judgment endpoint stays a judgment", () => {
  const r = classifySourceIntegrity({
    url:
      "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts/23/130/039/x11&fileName=23039130.x11&type=4&caseId=1234567",
    title: 'בג"ץ 1234/23 פלוני נ\' היועצת המשפטית לממשלה',
    snippet: "בבית המשפט העליון בשבתו כבית משפט גבוה לצדק. אשר על כן, העתירה נדחית. ניתן היום.",
    source_type: "caselaw",
  });
  assertEquals(r.citable_as, "judgment");
  assertEquals(r.judgment_identity_signals?.includes("official_judgment_endpoint"), true);
});

Deno.test("article analysing a judgment is downgraded to commentary", () => {
  const r = classifySourceIntegrity({
    url: "https://www.idi.org.il/articles/12345",
    title: 'בעקבות בג"ץ 5555/18 חסון נ\' כנסת ישראל — ניתוח פסק הדין',
    snippet: "במאמר זה נבחן את פסק הדין של בית המשפט העליון וקביעותיו.",
    source_type: "caselaw",
  });
  assertNotEquals(r.citable_as, "judgment");
  assertEquals(r.is_judgment_document, false);
  assertEquals((r.commentary_identity_signals ?? []).length > 0, true);
  assertEquals(r.has_holding_text, false);
});

Deno.test("news page with docket mention is not a judgment", () => {
  const r = classifySourceIntegrity({
    url: "https://www.ynet.co.il/news/article/abc123",
    title: 'בג"ץ 7052/03 עדאלה נ\' שר הפנים — מה נקבע',
    snippet: "בית המשפט העליון קבע כי העתירה מתקבלת.",
    source_type: "news",
  });
  assertEquals(r.citable_as, "commentary");
  assertEquals(r.commentary_identity_signals?.includes("commentary_host"), true);
});

Deno.test("nevo judgment file with docket stays a judgment", () => {
  const r = classifySourceIntegrity({
    url: "https://www.nevo.co.il/psakdin/123456.pdf",
    title: 'ע"א 6821/93 בנק המזרחי נ\' מגדל כפר שיתופי',
    snippet: "בבית המשפט העליון. כב' השופט ברק. אשר על כן, הערעור נדחה.",
    source_type: "caselaw",
  });
  assertEquals(r.citable_as, "judgment");
});

Deno.test("academic repository paper about a case is not a judgment", () => {
  const r = classifySourceIntegrity({
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4455667",
    title: "עיונים בעקבות הלכת בנק המזרחי",
    snippet: "מאמר אקדמי הבוחן את פסק הדין.",
    source_type: "journal_article",
  });
  assertNotEquals(r.citable_as, "judgment");
});
