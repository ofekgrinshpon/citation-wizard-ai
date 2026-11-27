import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IsraeliPartyChoiceButtons } from "@/components/IsraeliPartyChoiceButtons";
import { CHAT_HOST, RUNNER_HOST, WORD_HOST, needsBoundIsraeliPartyLookup, planCitationEvidence, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { groundIsraeliPartyDecisions, israeliPartyOptionId, parseIsraeliPartyQuery, readIsraeliPartyChoice, selectIsraeliPartyDecision } from "../../supabase/functions/_shared/israeliPartyDecisions";
import { citationRecoveryResult } from "../../supabase/functions/_shared/citationRecovery";

const raw = "זדורוב נ׳ מדינת ישראל";
const packet = (rows: unknown[]) => ({ search_results: rows, choices: [{ message: { content: "untrusted" } }] });
const ground = (input: string, ...rows: unknown[]) => groundIsraeliPartyDecisions(parseIsraeliPartyQuery(input)!, [packet(rows)]);
// Psikan heading verbatim in structure with the source-confirmed parties/date.
const dnp = { url: "https://psikan.com/rulings/דנפ-1329-16",
  title: "דנ\"פ 1329/16 רומן זדורוב נ' מדינת ישראל · החלטה, 5.7.2016 · פסיקן",
  snippet: "לפניי בקשה לדיון נוסף בפסק דינו של בית משפט זה בע״פ 7939/10 זדורוב נ' מדינת ישראל (23.12.2015)." };
// Original 2015 judicial PDF, with a condensed copy of its first-page header.
const din = { url: "https://www.din.co.il/images/10079390.w53.pdf", title: 'פסק-דין בתיק ע"פ  7939/10',
  snippet: 'בית המשפט העליון בשבתו כבית משפט לערעורים פליליים\nע״פ 7939/10\nלפני:\nכבוד השופט י׳ דנציגר\nכבוד השופט י׳ עמית\nכבוד השופט צ׳ זילברטל\nהמערער: רומן זדורוב\nנ ג ד\nהמשיבה: מדינת ישראל\nתאריך הישיבה: 20.10.2014' };
// Afik repro case pages have site dates: never copy them into the citation.
const afikRetrial = { url: "https://he.afiklaw.com/caselaw/12351",
  title: "מח 6881/19 רומן זדורוב נ' מדינת ישראל · פסקי דין · אפיק ושות׳",
  date: "2021-05-11", snippet: "11 מאי 2021\nבבית המשפט העליון\nמ״ח 6881/19\nהמבקש: רומן זדורוב\nנ ג ד\nהמשיבה 1: מדינת ישראל" };
const aPropim = { url: "https://he.afiklaw.com/caselaw/10495",
  title: 'עא 4628/93 מדינת ישראל נ\' אפרופים שיכון ויזום (1991) בע"מ, פ"ד מט(2) 265 · פסקי דין · אפיק ושות׳',
  snippet: '06 אפריל 1995\nערעור אזרחי מס\' 4628/93\nמדינת ישראל\nנגד\nאפרופים שיכון ויזום (1991) בע"מ\nבבית המשפט העליון בשבתו כבית-משפט לערעורים אזרחיים\n[6.4.95]' };

describe("grounded Israeli party choices", () => {
  it("finds coarse observed-source identities; preserves missing dates and exact source order", () => {
    const match = ground(raw, dnp, din, afikRetrial);
    expect(match.map(({ caseNumber, date }) => [caseNumber, date])).toEqual([
      ["1329/16", "5.7.2016"], ["6881/19", ""], ["7939/10", ""],
    ]);
    const reverseRaw = "מדינת ישראל נ׳ זדורוב";
    expect(ground(reverseRaw, dnp, din, afikRetrial)).toEqual(match);
    const reversedChoice = { version:1, rawInput:reverseRaw, records:match };
    expect(selectIsraeliPartyDecision(reversedChoice,israeliPartyOptionId(match[0]),reverseRaw)?.citation)
      .toContain("**זדורוב** נ׳ **מדינת ישראל**");
    expect(ground("ע״פ זדורוב נ׳ מדינת ישראל", dnp, din, afikRetrial).map(r => r.caseNumber)).toEqual(["7939/10"]);
    expect(ground("ע״פ מדינת ישראל נ׳ זדורוב", dnp, din, afikRetrial)).toEqual([]);
  });

  it("uses the real Afik district caption but cannot use the Psikan bench headline or Afik posting date", () => {
    const psikan = {
      url: "https://psikan.com/rulings/district-d661e470adc812ef-תפח-502-07",
      title: "תפ״ח 502/07 | בית המשפט המחוזי בנצרת | ביהמ״ש המחוזי נצרת, אב״ד סגן הנשיאה השופט אשר… | פסק דין, 30.3.2023 · פסיקן",
      snippet: "הכרעת דין במשפט החוזר של רומן זדורוב. מ״ח 6881/19 רומן זדורוב נ׳ מדינת ישראל (11.5.2021)." };
    const afik = {
      url: "https://he.afiklaw.com/caselaw/15186",
      title: "תפח (נצ') 502/07 מדינת ישראל נ' רומן זדורוב · פסקי דין · אפיק ושות׳",
      snippet: "31 מרץ 2023\nתפ״ח 502-07 מדינת ישראל נ׳ זדורוב (עצור/אסיר בפיקוח)" };
    expect(ground(raw,psikan)).toEqual([]);
    const [own] = ground(raw,psikan,afik);
    expect(own).toMatchObject({caseType:"תפ״ח",caseNumber:"502/07",date:"",party1:"מדינת ישראל",party2:"רומן זדורוב"});
    const one = {version:1,rawInput:raw,records:[own]};
    const cite = selectIsraeliPartyDecision(one,israeliPartyOptionId(own),raw)?.citation;
    expect(cite).toContain("תפ״ח (מחוזי נצ׳) 502/07 **מדינת ישראל** נ׳ **זדורוב**");
    expect(cite).not.toMatch(/30\.3|31\.3|11\.5/);
  });

  it("supports Barzilai's own case heading and rejects official historical cross-reference as case identity", () => {
    const barzilai = {url:"https://psikan.com/rulings/בגץ-428-86/86004280_z01-en",
      title:"בג״ץ 428/86 י ברזילי נ. ממשלת ישראל",
      snippet:"בג״ץ 428/86 י ברזילי נ. ממשלת ישראל (6.8.1986) · https://psikan.com/rulings/בגץ-428-86/86004280_z01-en" };
    expect(ground("ברזילי נ׳ ממשלת ישראל",barzilai)[0]).toMatchObject({caseNumber:"428/86",date:"6.8.1986"});
    expect(ground("קול העם נ׳ שר הפנים", {
      url:"https://globalfreedomofexpression.columbia.edu/wp-content/uploads/2016/03/5300073.pdf",
      title:"בג״ץ 73/53 ו-87/53 קול העם ואל אתיחאד נגד שר הפנים",
      snippet:"החלטה בערכאה ראשונה שפורסמה בפ״ד ז 871" })).toEqual([]);
    expect(ground("קול העם נ׳ שר הפנים", {
      url:"https://www.gov.il/BlobFolder/guide/relevant-case-law-cor/he/70105-05-25.pdf",
      title:"ת״א 70105-05-25",
      snippet:"בג״ץ 73/53 חברת קול העם בע״מ נ׳ שר הפנים, פ״ד ז 871 (1953)." })).toEqual([]);
  });

  it("requires the real Afik own caption + official header date, not the page date or publisher footer", () => {
    const [ok] = ground("מדינת ישראל נ׳ אפרופים", aPropim);
    expect(ok).toMatchObject({ caseType: "ע״א", caseNumber: "4628/93", date: "6.4.1995",
      court: "בית המשפט העליון", publication: {padi_volume:"מט",padi_part:"2",padi_page:"265",year:"1995"} });
    expect(ground("מדינת ישראל נ׳ אפרופים", {...aPropim, snippet: aPropim.snippet.replace("מס' 4628/93", "מס' 7939/10")})[0])
      .toMatchObject({ date:"" });
    expect(ground("מדינת ישראל נ׳ אפרופים", {...aPropim, url: aPropim.url + "/52"})).toEqual([]);
  });

  it("rejects a cross-reference body, mistyped court PDF, bad date and hostile source", () => {
    expect(ground("ע״פ זדורוב נ׳ מדינת ישראל", dnp)).toEqual([]);
    expect(ground(raw, {...din,url:"https://www.din.co.il/images/10079380.w53.pdf"})).toEqual([]);
    expect(ground(raw, {...dnp,title:dnp.title.replace("5.7.2016","31.2.2016")})).toEqual([]);
    expect(ground(raw, {...dnp,url:"https://psikan.com.example.org/rulings/דנפ-1329-16"})).toEqual([]);
    expect(ground(raw, {...dnp,url:dnp.url.replace("1329-16","1329-17")})).toEqual([]);
  });

  it("uses exact dated identities, rejects conflicting same URL, and keeps one genuine duplicate once", () => {
    const older = {...dnp, url: dnp.url + "/other-decision", title:dnp.title.replace("5.7.2016","17.4.2016")};
    const records = ground(raw, dnp, dnp, older);
    expect(records.map(r=>r.date)).toEqual(["5.7.2016","17.4.2016"]);
    expect(new Set(records.map(israeliPartyOptionId)).size).toBe(2);
    expect(ground(raw, dnp, {...older,url:dnp.url})).toEqual([]);
  });

  it("applies the exact selected decision, not another date or modified query", () => {
    const records = ground(raw, dnp, din);
    const envelope = {version:1 as const,rawInput:raw,records};
    const id = israeliPartyOptionId(records[0]);
    expect(selectIsraeliPartyDecision(envelope,id,raw)?.citation).toContain("5.7.2016");
    expect(selectIsraeliPartyDecision(envelope,id,raw)?.citation).not.toContain("7939/10");
    expect(selectIsraeliPartyDecision(envelope,id,"זדורוב נ׳ היועץ המשפטי לממשלה")).toBeNull();
    expect(readIsraeliPartyChoice({...envelope, records:[{...records[0],party1:"ישראל ישראלי"}]}, raw)).toBeNull();
  });

  it("keeps exact dockets outside the party cache guard", () => {
    expect(needsBoundIsraeliPartyLookup("case_law_database", raw)).toBe(true);
    expect(needsBoundIsraeliPartyLookup("case_law_database", "ע״פ 7939/10")).toBe(false);
    expect(needsBoundIsraeliPartyLookup("foreign_case_other",raw)).toBe(false);
  });
});

describe("server records, planner and actual buttons", () => {
  const recordData = {version:1 as const,rawInput:raw,records:ground(raw,dnp,din)};
  const plan = planTypedRequest({ evidence:planCitationEvidence(raw,null), sourceType:"case_law_database", input:raw,
    isPinpoint:false,manual:false,statutePrep:null,canonicalRaw:raw }, CHAT_HOST);
  const data = { content:"UNSAFE 1. illustrative line", israeliPartyLookup:recordData };
  it("never consumes the fallback/formatting text, and only chat exposes ambiguity choices", () => {
    const chat = resolveCitationResponse(plan,data,CHAT_HOST);
    expect(chat).toMatchObject({kind:"terminal", resolution:{israeliPartyChoice:recordData}});
    if (chat.kind === "terminal") expect(chat.resolution.reply).not.toContain("UNSAFE");
    for (const caps of [WORD_HOST,RUNNER_HOST]) {
      const r = resolveCitationResponse(plan,data,caps);
      expect(r).toMatchObject({kind:"terminal",resolution:{status:"warning",citation:raw}});
      if (r.kind === "terminal") expect(r.resolution.israeliPartyChoice).toBeUndefined();
    }
  });
  it("does not promote an old Edge Function reply when typed evidence is absent", () => {
    const stale = resolveCitationResponse(plan,{content:"1. ע״פ 999/10 <!--DATA:bad-->"},CHAT_HOST);
    expect(stale).toMatchObject({kind:"terminal",resolution:{status:"warning",citation:raw}});
    if (stale.kind === "terminal") {
      expect(stale.resolution.reply).not.toContain("999/10");
      expect(stale.resolution.israeliPartyChoice).toBeUndefined();
    }
  });
  it("strips transient proofs from the existing recovery contract", () => {
    expect(citationRecoveryResult(data)).toEqual({content:data.content});
  });
  it("shows separate source-linked options, locks double selection and never submits a form", () => {
    const pick = vi.fn(() => true), submit = vi.fn((evt) => evt.preventDefault());
    render(<form onSubmit={submit}><IsraeliPartyChoiceButtons choice={recordData} onSelect={pick} /></form>);
    const btn = screen.getByRole("button",{name:/1329\/16.*5\.7\.2016/});
    expect(screen.getByRole("link",{name:"מקור להחלטה 1"})).toHaveAttribute("href",recordData.records[0].sourceUrl);
    fireEvent.click(btn); fireEvent.click(btn);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith(israeliPartyOptionId(recordData.records[0]));
    expect(submit).not.toHaveBeenCalled();
  });
});
