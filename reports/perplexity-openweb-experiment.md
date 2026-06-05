# Perplexity Open-Web Experiment — citation-chat

Variants run per source:
- **A** allowlist (current production: 6 court/db domains)
- **B** open web search + post-filter via trust gate (TRUSTED_LEGAL ∪ TRUSTED_PUB)
- **C** fully open web — no filter, no gate (marked `unverified` in production)

## Aggregate hit-rate

| Variant | Found | Total |
|---|---|---|
| A | 8 | 14 |
| B | 14 | 14 |
| C | 14 | 14 |

## Per-source results

### 1. בג"ץ 3545-11-25 ח"כ אביחי בוארון נ' היועצת המשפטית לממשלה  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4` (2800ms, returned=4, kept=1)
  - canonical: `בג"ץ 3545-11-25 אביחי בוארון ואחרים נ' היועצת המשפטית לממשלה`
  - summary: פסק דין של בית המשפט העליון בשבתו כבג"ץ, שבו מופיע התיק 3545-11-25 בכותרת הרשמית. השם הקצר המבוקש הוא גרסה מקוצרת של שם ההליך הרשמי.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4, https://he.wikipedia.org/wiki/%D7%91%D7%92%22%D7%A5_%D7%90%D7%91%D7%99%D7%97%D7%99_%D7%90%D7%91%D7%A8%D7%94%D7%9D_%D7%91%D7%95%D7%90%D7%A8%D7%95%D7%9F_%D7%A0%D7%92%D7%93_%D7%94%D7%99%D7%95%D7%A2%D7%A5_%D7%94%D7%9E%D7%A9%D7%A4%D7%98%D7%99_%D7%9C%D7%9E%D7%9E%D7%A9%D7%9C%D7%94, https://img.mako.co.il/2025/11/07/fvfv.pdf, https://www.toledano.co.il/%D7%91%D7%92%D7%A5-3545-11-25-%D7%90%D7%91%D7%99%D7%97%D7%99-%D7%90%D7%91%D7%A8%D7%94%D7%9D-%D7%91%D7%95%D7%90%D7%A8%D7%95%D7%9F-%D7%A0-%D7%94%D7%99%D7%95%D7%A2%D7%A5-%D7%94%D7%9E%D7%A9%D7%A4%D7%98/
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4` (2690ms, returned=8, kept=1)
  - canonical: `בבית המשפט העליון בשבתו כבית משפט גבוה לצדק
בג"ץ 3545-11-25
ח"כ אביחי בוארון נ' היועצת המשפטית לממשלה`
  - summary: פסק דין של בית המשפט העליון בבג"ץ 3545-11-25, שניתן ביום 16.11.2025. המסמך כולל את כותרת ההליך והצדדים, ובו העתירה של ח"כ אביחי בוארון נגד היועצת המשפטית לממשלה.
  - citations: https://a7.org/?file=20251116103253.pdf, https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4, https://he.wikipedia.org/wiki/%D7%91%D7%92%22%D7%A5_%D7%90%D7%91%D7%99%D7%97%D7%99_%D7%90%D7%91%D7%A8%D7%94%D7%9D_%D7%91%D7%95%D7%90%D7%A8%D7%95%D7%9F_%D7%A0%D7%92%D7%93_%D7%94%D7%99%D7%95%D7%A2%D7%A5_%D7%94%D7%9E%D7%A9%D7%A4%D7%98%D7%99_%D7%9C%D7%9E%D7%9E%D7%A9%D7%9C%D7%94, https://www.scribd.com/document/944143240/%D7%94%D7%AA%D7%99%D7%99%D7%97%D7%A1%D7%95%D7%AA-%D7%9C%D7%98%D7%A2%D7%A0%D7%95%D7%AA-%D7%91%D7%93%D7%91%D7%A8-%D7%A0%D7%99%D7%92%D7%95%D7%93-%D7%A2%D7%A0%D7%99%D7%99%D7%A0%D7%99%D7%9D-%D7%A9%D7%9C-%D7%94%D7%99%D7%95%D7%A2%D7%A6%D7%AA-%D7%94%D7%9E%D7%A9%D7%A4%D7%98%D7%99%D7%AA-%D7%9C%D7%9E%D7%9E%D7%A9%D7%9C%D7%94, https://lawprofsforum.org/?jet_download=31a2099e9c8902d9c7989d40d0eb8a245257835a, https://img.mako.co.il/2025/11/06/yoamgal.pdf
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4` (2916ms, returned=9, kept=9)
  - canonical: `בבית המשפט העליון בשבתו כבית משפט גבוה לצדק
בג"ץ 3545-11-25
לפני: כבוד השופטת יעל וילנר, כבוד השופט אלכס שטיין, כבוד השופטת גילה כנפי-שטייניץ
ח"כ אביחי בוארון
נ' היועצת המשפטית לממשלה`
  - summary: פסק הדין של בג"ץ 3545-11-25 מופיע באתר פסקי הדין של בית המשפט העליון. זהו ההליך שבו ח"כ אביחי בוארון עתר נגד היועצת המשפטית לממשלה; המסמך המצורף הוא נוסח פסק הדין/ההחלטה הרשמי.
  - citations: https://a7.org/?file=20251116103253.pdf, https://lawprofsforum.org/?jet_download=31a2099e9c8902d9c7989d40d0eb8a245257835a, https://www.scribd.com/document/944143240/%D7%94%D7%AA%D7%99%D7%99%D7%97%D7%A1%D7%95%D7%AA-%D7%9C%D7%98%D7%A2%D7%A0%D7%95%D7%AA-%D7%91%D7%93%D7%91%D7%A8-%D7%A0%D7%99%D7%92%D7%95%D7%93-%D7%A2%D7%A0%D7%99%D7%99%D7%A0%D7%99%D7%9D-%D7%A9%D7%9C-%D7%94%D7%99%D7%95%D7%A2%D7%A6%D7%AA-%D7%94%D7%9E%D7%A9%D7%A4%D7%98%D7%99%D7%AA-%D7%9C%D7%9E%D7%9E%D7%A9%D7%9C%D7%94, https://www.idi.org.il/articles/63090, https://he.wikipedia.org/wiki/%D7%91%D7%92%22%D7%A5_%D7%90%D7%91%D7%99%D7%97%D7%99_%D7%90%D7%91%D7%A8%D7%94%D7%9D_%D7%91%D7%95%D7%90%D7%A8%D7%95%D7%9F_%D7%A0%D7%92%D7%93_%D7%94%D7%99%D7%95%D7%A2%D7%A5_%D7%94%D7%9E%D7%A9%D7%A4%D7%98%D7%99_%D7%9C%D7%9E%D7%9E%D7%A9%D7%9C%D7%94, https://img.mako.co.il/2025/11/06/yoamgal.pdf

### 2. חוק יסוד: משק המדינה  
_type: statute_

- **A** — ✅ `https://www.nevo.co.il/law_html/law01/p169_001.htm` (2122ms, returned=4, kept=4)
  - canonical: `חוק יסוד: משק המדינה`
  - summary: החוק קובע את מסגרת המשק והתקציב של המדינה, ובין היתר כי תקציב המדינה ייקבע בחוק, יהיה לשנה אחת, וכי הממשלה תניח את הצעת חוק התקציב על שולחן הכנסת במועדים הקבועים בחוק.
  - citations: https://www.psakdin.co.il/Law/%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93-%D7%9E%D7%A9%D7%A7-%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F10%2F080%2F049%2Fn08&fileName=10049080_n08.txt&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C20%5C690%5C059%5Cv16&fileName=20059690.V16&type=2, https://www.takdin.co.il/document/index/6506002-%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93-%D7%9E%D7%A9%D7%A7-%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94-%D7%AA%D7%99%D7%A7%D7%95%D7%9F-%D7%9E%D7%A1-10-%D7%95%D7%94%D7%95%D7%A8%D7%90%D7%AA-%D7%A9%D7%A2%D7%94-%D7%9C%D7%A9%D7%A0%D7%AA-2020
- **B** — ✅ `https://main.knesset.gov.il/apps/legislation/main/laws/2000049` (2445ms, returned=8, kept=4)
  - canonical: `חוק-יסוד: משק המדינה`
  - summary: חוק יסוד ישראלי הקובע את כללי התקציב, המיסים והביקורת על כספי המדינה. הוא אושר לראשונה בשנת 1975 ומכיל הוראות לגבי תקציב המדינה, תקציב רב-שנתי, אי-קבלת חוק התקציב, וחקיקה הצריכה תקציב.
  - citations: https://tazkirim.gov.il/s/legislativeworkactivity/a133Y00000K4NqfQAF/%D7%94%D7%A4%D7%A6%D7%94-%D7%9C%D7%94%D7%A2%D7%A8%D7%95%D7%AA-%D7%A6%D7%99%D7%91%D7%95%D7%A8?language=iw, https://m.knesset.gov.il/Activity/Legislation/Documents/yesod11.pdf, https://he.wikipedia.org/wiki/%D7%97%D7%95%D7%A7_%D7%99%D7%A1%D7%95%D7%93:_%D7%9E%D7%A9%D7%A7_%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94, https://he.wikisource.org/wiki/%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93:_%D7%9E%D7%A9%D7%A7_%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94, https://www.hilan.co.il/%D7%9E%D7%A8%D7%9B%D7%96-%D7%99%D7%93%D7%A2/%D7%97%D7%A7%D7%99%D7%A7%D7%94/%D7%97%D7%95%D7%A7%D7%99-%D7%99%D7%A1%D7%95%D7%93/%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93-%D7%9E%D7%A9%D7%A7-%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94/, https://www.lib.cet.ac.il/pages/item.asp?item=18044
- **C** — ✅ `https://main.knesset.gov.il/apps/legislation/main/laws/2000049` (3760ms, returned=9, kept=9)
  - canonical: `חוק-יסוד: משק המדינה`
  - summary: חוק יסוד הקובע את עקרונות התקציב, המיסים והביקורת על ביצוע תקציב המדינה. ניתן לעיין בנוסח המאוחד במאגר החקיקה הלאומי של הכנסת.
  - citations: https://m.knesset.gov.il/Activity/Legislation/Documents/yesod11.pdf, https://he.wikipedia.org/wiki/%D7%97%D7%95%D7%A7_%D7%99%D7%A1%D7%95%D7%93:_%D7%9E%D7%A9%D7%A7_%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94, https://tazkirim.gov.il/s/legislativeworkactivity/a133Y00000K4NqfQAF/%D7%94%D7%A4%D7%A6%D7%94-%D7%9C%D7%94%D7%A2%D7%A8%D7%95%D7%AA-%D7%A6%D7%99%D7%91%D7%95%D7%A8?language=iw, https://he.wikisource.org/wiki/%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93:_%D7%9E%D7%A9%D7%A7_%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94, https://www.hilan.co.il/%D7%9E%D7%A8%D7%9B%D7%96-%D7%99%D7%93%D7%A2/%D7%97%D7%A7%D7%99%D7%A7%D7%94/%D7%97%D7%95%D7%A7%D7%99-%D7%99%D7%A1%D7%95%D7%93/%D7%97%D7%95%D7%A7-%D7%99%D7%A1%D7%95%D7%93-%D7%9E%D7%A9%D7%A7-%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94/, https://www.lib.cet.ac.il/pages/item.asp?item=18044

### 3. בג"ץ 2056/04  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F560%2F020%2FA28&fileName=04020560_A28.txt&type=4` (2440ms, returned=10, kept=10)
  - canonical: `בג"ץ 2056/04 מועצת הכפר בית סוריק ואח' נ' ממשלת ישראל, פ"ד נח(5) 807 (2004)`
  - summary: פסק הדין הידוע כעניין בית סוריק, שבו נדונה חוקיות תוואי גדר ההפרדה ונקבעה בחינה מידתית של הפגיעה בזכויות התושבים המקומיים.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F19%2F520%2F084%2Ff15&fileName=19084520.F15&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C17%5C940%5C007%5Ch09&fileName=17007940.H09&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C06%5C090%5C103%5CN05&fileName=06103090_n05.txt&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F570%2F079%2FA14&fileName=04079570_A14.txt&type=4, https://supremedecisions.court.gov.il/Home/Download?path=PediVerdicts%5C61%5C1&fileName=SA1_17_9593-04.pdf&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F20%2F710%2F035%2Fe11&fileName=20035710.E11&type=4
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F560%2F020%2FA28&fileName=04020560_A28.txt&type=4` (2731ms, returned=7, kept=2)
  - canonical: `בג"ץ 2056/04 מועצת הכפר בית סוריק ואחרים נ' ממשלת ישראל ואחר, פ"ד נ"ח(5) 807 (30.6.2004)`
  - summary: פסק הדין המרכזי בעניין תוואי גדר ההפרדה (פרשת בית סוריק). בית המשפט דן בסמכות להקמת הגדר ובמידתיות התוואי, וקבע כי חלק מן המקטעים שנדונו אינם חוקיים ועל המדינה להציג תוואי חלופי.
  - citations: https://www.thelawfilm.com/inside/resource/hebrew/bgz_2056_04, https://he.wikipedia.org/wiki/%D7%91%D7%92%22%D7%A5_%D7%91%D7%99%D7%AA_%D7%A1%D7%95%D7%A8%D7%99%D7%A7_%D7%A0%D7%92%D7%93_%D7%9E%D7%9E%D7%A9%D7%9C%D7%AA_%D7%99%D7%A9%D7%A8%D7%90%D7%9C, http://adam-adama.org/_Uploads/dbsAttachedFiles/2(1).pdf, https://www.btselem.org/heb/legal_documents/hc2056_04_beit_surik_barrier_ruling_summary.doc, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F570%2F079%2FA14&fileName=04079570_A14.txt&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F560%2F020%2FA28&fileName=04020560_A28.txt&type=4
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F560%2F020%2FA28&fileName=04020560_A28.txt&type=4` (2509ms, returned=8, kept=8)
  - canonical: `בג"ץ 2056/04 מועצת הכפר בית סוריק ואחרים נ' ממשלת ישראל ואחר, פ"ד נח(5) 807 (30.6.2004)`
  - summary: פסק דין תקדימי בעניין תוואי גדר ההפרדה; נקבע כי יש לבחון כל מקטע בנפרד וכי חלק מן התוואי אינו מידתי ולכן אינו חוקי.
  - citations: https://www.thelawfilm.com/inside/resource/hebrew/bgz_2056_04, https://he.wikipedia.org/wiki/%D7%91%D7%92%22%D7%A5_%D7%91%D7%99%D7%AA_%D7%A1%D7%95%D7%A8%D7%99%D7%A7_%D7%A0%D7%92%D7%93_%D7%9E%D7%9E%D7%A9%D7%9C%D7%AA_%D7%99%D7%A9%D7%A8%D7%90%D7%9C, https://www.btselem.org/heb/legal_documents/hc2056_04_beit_surik_barrier_ruling_summary.doc, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F570%2F079%2FA14&fileName=04079570_A14.txt&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F04%2F560%2F020%2FA28&fileName=04020560_A28.txt&type=4, https://www.studocu.com/il/document/%D7%94%D7%A7%D7%A8%D7%99%D7%94-%D7%94%D7%90%D7%A7%D7%93%D7%9E%D7%99%D7%AA-%D7%90%D7%95%D7%A0%D7%95/%D7%9E%D7%A9%D7%A4%D7%98-%D7%9E%D7%A0%D7%94%D7%9C%D7%99/%D7%91%D7%92%D7%A5-2056-04-%D7%9E%D7%95%D7%A2%D7%A6%D7%AA-%D7%94%D7%9B%D7%A4%D7%A8-%D7%91%D7%99%D7%AA-%D7%A1%D7%95%D7%A8%D7%99%D7%A7-%D7%95%D7%90%D7%97-%D7%A0-%D7%9E%D7%9E%D7%A9%D7%9C%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%95%D7%9E%D7%A4%D7%A7%D7%93-%D7%9B%D7%95%D7%97%D7%95%D7%AA-%D7%A6%D7%94%D7%9C-%D7%91%D7%92%D7%93%D7%94/94250346

### 4. בג"ץ 1661/05  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4` (3676ms, returned=10, kept=10)
  - canonical: `בג"ץ 1661/05 המועצה האזורית חוף עזה נ' כנסת ישראל, פ"ד נט(2) 481 (2005)`
  - summary: פסק הדין המרכזי בעניין חוק יישום תוכנית ההתנתקות, שניתן בבג"ץ 1661/05. במקור נוסף מצוין כי ההליך נדון ופורסם כפס"ד ע"י בית המשפט העליון, עם הפניה לפ"ד נט(2) 481.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4, https://www.psakdin.co.il/Court/%D7%A4%D7%A1%D7%A7-%D7%93%D7%99%D7%9F-%D7%91%D7%AA%D7%99%D7%A7-%D7%91%D7%92%22%D7%A5-7918-05, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F18%2F030%2F030%2Fk08&fileName=18030030.K08&type=2, https://supremedecisions.court.gov.il/Home/Download?path=PediVerdicts%2F63%2F2&fileName=SG2_9_2605-05.pdf&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F16%2F550%2F063%2Fz05&fileName=16063550_z05.txt&type=2, https://supremedecisions.court.gov.il/Home/Download?path=PediVerdicts%5C62%5C1&fileName=SB1_1_8276-05.pdf&type=4
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4` (2316ms, returned=9, kept=3)
  - canonical: `בג"ץ 1661/05 המועצה האזורית חוף עזה נ' כנסת ישראל, פ"ד נט(2) 481`
  - summary: פסק הדין המרכזי בעניין חוק יישום תכנית ההתנתקות. בית המשפט העליון דן בעתירות נגד חוקיות החוק, קבע ברוב דעות שהחוק תקף ברובו, וביטל או שינה רק חלק מההוראות.
  - citations: https://he.afiklaw.com/caselaw/10567/41, http://adam-adama.org/_Uploads/dbsAttachedFiles/2(1).pdf, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4, https://fs.knesset.gov.il/25/law/25_ls_bk_1961815.pdf, https://law.haifa.ac.il/wp-content/uploads/2021/11/separating.pdf, https://he.wikipedia.org/wiki/%D7%97%D7%95%D7%A7_%D7%94%D7%94%D7%AA%D7%A0%D7%AA%D7%A7%D7%95%D7%AA_%D7%95%D7%94%D7%A4%D7%99%D7%A6%D7%95%D7%99%D7%99%D7%9D_%D7%9C%D7%A0%D7%A4%D7%92%D7%A2%D7%99%D7%94
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4` (2247ms, returned=9, kept=9)
  - canonical: `בג"ץ 1661/05 המועצה האזורית חוף עזה נ' כנסת ישראל, פ"ד נט(2) 481`
  - summary: פסק דין של בית המשפט העליון (בג"ץ 1661/05) שדן בחוקתיות חוק יישום תכנית ההתנתקות. הפסק אושר ברוב דעות ופורסם בפ"ד נט(2) 481.
  - citations: https://he.afiklaw.com/caselaw/10567/41, http://adam-adama.org/_Uploads/dbsAttachedFiles/2(1).pdf, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C05%2F550%2F074%2Fa04&fileName=05074550.a04&type=4, https://fs.knesset.gov.il/25/law/25_ls_bk_1961815.pdf, https://law.haifa.ac.il/wp-content/uploads/2021/11/separating.pdf, https://he.wikipedia.org/wiki/%D7%97%D7%95%D7%A7_%D7%94%D7%94%D7%AA%D7%A0%D7%AA%D7%A7%D7%95%D7%AA_%D7%95%D7%94%D7%A4%D7%99%D7%A6%D7%95%D7%99%D7%99%D7%9D_%D7%9C%D7%A0%D7%A4%D7%92%D7%A2%D7%99%D7%94

### 5. אהרן ברק "שיקול דעת המפקד ושיקול דעת השופט"  
_type: article_

- **A** — ❌ `—` (3090ms, returned=9, kept=9)
  - summary: לא נמצא במקורות שסופקו מקור ראשוני/אקדמי אמין המזהה בוודאות את הציטוט המלא של אהרן ברק "שיקול דעת המפקד ושיקול דעת השופט".
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C17%5C940%5C007%5Ch09&fileName=17007940.H09&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F07%2F660%2F004%2Fo30&fileName=07004660_o30.txt&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F17%2F900%2F101%2Fv12&fileName=17101900.V12&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C11%5C080%5C039%5Cb12&fileName=11039080_b12.txt&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F17%2F580%2F037%2Fw22&fileName=17037580_w22.txt&type=2, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F23%2F580%2F056%2Fv31&fileName=23056580.V31&type=2
- **B** — ✅ `https://www.nli.org.il/he/books/NNL_ALEPH990010982590205171/NLI` (2679ms, returned=9, kept=3)
  - canonical: `אהרן ברק, שיקול דעת שיפוטי, תל אביב: פפירוס, תשמ"ז 1987.`
  - summary: זהו ספרו של אהרן ברק. לפי הרשומה בספרייה הלאומית, שם הספר הוא "שיקול דעת שיפוטי". המקור אינו נראה כפריט נפרד בשם "שיקול דעת המפקד ושיקול דעת השופט", ולכן סביר שמדובר באזכור שגוי או בחלק מתוך ספר/מאמר אחר.
  - citations: https://www.idi.org.il/articles/16402, https://law.haifa.ac.il/wp-content/uploads/2021/11/7-bendor.pdf, https://kotar.cet.ac.il/kotarapp/index/Chapter.aspx?nBookID=97573396&nTocEntryID=97575392, https://he.wikipedia.org/wiki/%D7%90%D7%94%D7%A8%D7%9F_%D7%91%D7%A8%D7%A7, https://lawjournal.huji.ac.il/sites/default/files/2018-02/mishpatim-18-3-509.pdf, https://www.youtube.com/watch?v=d4FGORY8dWQ
- **C** — ✅ `https://www.nli.org.il/he/books/NNL_ALEPH990010982590205171/NLI` (2347ms, returned=9, kept=9)
  - canonical: `ברק, אהרן. *שיקול דעת שיפוטי*. תל אביב: פפירוס, תשמ״ז (1987).`
  - summary: ספרו של אהרן ברק המבוקש הוא 'שיקול דעת שיפוטי'. לפי הספרייה הלאומית, זהו ספר בהוצאת פפירוס משנת 1987, בהיקף 587 עמודים.
  - citations: https://www.idi.org.il/articles/16402, https://law.haifa.ac.il/wp-content/uploads/2021/11/7-bendor.pdf, https://kotar.cet.ac.il/kotarapp/index/Chapter.aspx?nBookID=97573396&nTocEntryID=97575392, https://he.wikipedia.org/wiki/%D7%90%D7%94%D7%A8%D7%9F_%D7%91%D7%A8%D7%A7, https://lawjournal.huji.ac.il/sites/default/files/2018-02/mishpatim-18-3-509.pdf, https://www.youtube.com/watch?v=d4FGORY8dWQ

### 6. דוד ברלינר "בג"ץ ומלחמות ישראל - הריסון השיפוטי של צה"ל"  
_type: article_

- **A** — ❌ `—` (2137ms, returned=0, kept=0)
  - summary: לא אותר מקור אמין/ראשוני עבור הציטוט המבוקש.
- **B** — ✅ `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4933655` (2240ms, returned=10, kept=0)
  - canonical: `דוד ברלינר, "בג"ץ ומלחמות ישראל - הריסון השיפוטי של צה"ל"`
  - summary: מאמר אקדמי בעברית מאת עו"ד דוד ברלינר, פורסם ב-SSRN ב-26 בפברואר 2025; שם האנגלית המקביל הוא "The Israeli Supreme Court at Wartime: Judicial Restraint of the IDF".
  - citations: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4933655, https://www.youtube.com/watch?v=UZbaVW8ulbI, https://open.spotify.com/episode/6QxQAFSDjKZNNjZIduQZ6s, https://mida.org.il/2024/10/10/%D7%A2%D7%95%D7%93-%D7%93%D7%95%D7%93-%D7%91%D7%A8%D7%9C%D7%99%D7%A0%D7%A8-%D7%9C%D7%9E%D7%A8%D7%95%D7%AA-%D7%9E%D7%94-%D7%A9%D7%A0%D7%98%D7%A2%D7%9F-%D7%91%D7%92%D7%A5-%D7%9B%D7%95%D7%91/, https://www.inn.co.il/news/654460, https://www.youtube.com/watch?v=F4F1M8XCnbk
- **C** — ✅ `https://papers.ssrn.com/sol3/Delivery.cfm/4933655.pdf?abstractid=4933655&mirid=1` (2684ms, returned=10, kept=10)
  - canonical: `דוד ברלינר, "בג"ץ ומלחמות ישראל - הריסון השיפוטי של צה"ל", *הגלימה והחרב: השפעת בג"ץ על שדה הקרב במלחמות ישראל* (מרץ 2025; נכתב 7 באוגוסט 2024).`
  - summary: זהו מאמר אקדמי מאת עו"ד דוד ברלינר, המופיע ב-SSRN תחת הכותרת "The Israeli Supreme Court at Wartime: Judicial Restraint of the IDF". לפי התצוגה ב-SSRN, המאמר בעברית נושא את הכותרת המבוקשת, והוא זמין גם כקובץ PDF להורדה.
  - citations: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4933655, https://www.youtube.com/watch?v=UZbaVW8ulbI, https://www.podchaser.com/podcasts/1047916/episodes/606-226904386, https://open.spotify.com/episode/6QxQAFSDjKZNNjZIduQZ6s, https://mida.org.il/2024/10/10/%D7%A2%D7%95%D7%93-%D7%93%D7%95%D7%93-%D7%91%D7%A8%D7%9C%D7%99%D7%A0%D7%A8-%D7%9C%D7%9E%D7%A8%D7%95%D7%AA-%D7%9E%D7%94-%D7%A9%D7%A0%D7%98%D7%A2%D7%9F-%D7%91%D7%92%D7%A5-%D7%9B%D7%95%D7%91/, https://www.inn.co.il/news/654460

### 7. בג"ץ 58681-11-25  
_type: case_

- **A** — ❌ `—` (2272ms, returned=0, kept=0)
  - summary: לא נמצא מקור מאומת עבור בג"ץ 58681-11-25 על סמך המידע שסופק.
- **B** — ✅ `https://img.mako.co.il/2025/12/03/PSAKHAMO.pdf` (2813ms, returned=7, kept=3)
  - canonical: `בג"ץ 58681-11-25 לשכת עורכי הדין בישראל נ' שר המשפטים`
  - summary: פסק דין של בית המשפט העליון בשבתו כבית משפט גבוה לצדק, שניתן ביום 3.12.2025, בעניינה של לשכת עורכי הדין בישראל נגד שר המשפטים, סביב החלטת השר להטיל על השופט בדימוס יוסף בן-חמו את תפקיד הליווי והפיקוח על חקירת הפרשה הנדונה.
  - citations: https://www.toledano.co.il/%D7%91%D7%92%D7%A5-58681-11-25-%D7%A0%D7%99%D7%AA%D7%95%D7%97-%D7%A4%D7%A1%D7%A7-%D7%94%D7%93%D7%99%D7%9F-%D7%94%D7%9E%D7%98%D7%9C%D7%98%D7%9C/, https://a7.org/?file=20251203172513.pdf, https://img.mako.co.il/2025/12/03/PSAKHAMO.pdf, https://www.idi.org.il/articles/63090, https://www.gov.il/BlobFolder/dynamiccollectorresultitem/decision18225-06-25/he/18225-06-25.psakd_.pdf, https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F12%2F23%2F2025-11-18615-9-1&fileName=370f2649aff6419eaa77ee9556697d4f&type=4
- **C** — ✅ `https://img.mako.co.il/2025/12/03/PSAKHAMO.pdf` (3017ms, returned=7, kept=7)
  - canonical: `בבית המשפט העליון בשבתו כבית משפט גבוה לצדק 58681-11-25 בג"ץ לשכת עורכי הדין בישראל נ' שר המשפטים; בג"ץ 64154-11-25 התנועה למען איכות השלטון בישראל נ' שר המשפטים`
  - summary: פסק הדין המלא מאגד את בג"ץ 58681-11-25 עם בג"ץ 64154-11-25, וניתן ביום 3.12.2025. הוא עוסק בעתירות נגד החלטת שר המשפטים להטיל על השופט בדימוס יוסף בן-חמו תפקיד הנוגע לליווי חקירת פרשת "שדה תימן".
  - citations: https://www.toledano.co.il/%D7%91%D7%92%D7%A5-58681-11-25-%D7%A0%D7%99%D7%AA%D7%95%D7%97-%D7%A4%D7%A1%D7%A7-%D7%94%D7%93%D7%99%D7%9F-%D7%94%D7%9E%D7%98%D7%9C%D7%98%D7%9C/, https://img.mako.co.il/2025/11/26/levin.pdf, https://z.calcalist.co.il/assets/pickerul/33dbd4af-060e-461f-8fc4-e1ad757f08a4.pdf, https://img.mako.co.il/2025/12/03/PSAKHAMO.pdf, https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F11%2F26%2F2025-11-3545-24-2&fileName=734eb0bf9a010000090037f6afbb9d04&type=4, https://www.toledano.co.il/%D7%91%D7%92%D7%A5-58681-11-25-%D7%9C%D7%A9%D7%9B%D7%AA-%D7%A2%D7%95%D7%A8%D7%9B%D7%99-%D7%94%D7%93%D7%99%D7%9F-%D7%91%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%A0-%D7%A9%D7%A8-%D7%94%D7%9E%D7%A9%D7%A4/

### 8. בג"ץ 4769/24  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4` (3338ms, returned=5, kept=5)
  - canonical: `בג"ץ 4769/24 — משמר הדמוקרטיה הישראלית ואח' נ' ועדת השרים לענייני חקיקה ואח'`
  - summary: פסק דין של בית המשפט העליון בשבתו כבג"ץ בתיק 4769/24. לפי המסמך, העותרים הם משמר הדמוקרטיה הישראלית ופורום איילון לזכויות אדם, והמשיבים הם ועדת השרים לענייני חקיקה ואחרים.
  - citations: https://lite.takdin.co.il/search-results?t=%D7%A4%D7%95%D7%A8%D7%95%D7%9D+%D7%90%D7%99%D7%99%D7%9C%D7%95%D7%9F+%D7%9C%D7%96%D7%9B%D7%95%D7%99%D7%95%D7%AA+%D7%90%D7%93%D7%9D, https://lite.takdin.co.il/search-results?t=%D7%9E%D7%A9%D7%9E%D7%A8+%D7%94%D7%93%D7%9E%D7%95%D7%A7%D7%A8%D7%98%D7%99%D7%94+%D7%94%D7%99%D7%A9%D7%A8%D7%90%D7%9C%D7%99%D7%AA, https://lite.takdin.co.il/search-results?t=%D7%95%D7%A2%D7%93%D7%AA+%D7%94%D7%A9%D7%A8%D7%99%D7%9D+%D7%9C%D7%A2%D7%A0%D7%99%D7%99%D7%A0%D7%99+%D7%97%D7%A7%D7%99%D7%A7%D7%94, https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4, https://lite.takdin.co.il/document/8021325/%D7%91%D7%92%D7%A6-476924---%D7%9E%D7%A9%D7%9E%D7%A8-%D7%94%D7%93%D7%9E%D7%95%D7%A7%D7%A8%D7%98%D7%99%D7%94-%D7%94%D7%99%D7%A9%D7%A8%D7%90%D7%9C%D7%99%D7%AA-%D7%A0-%D7%95%D7%A2%D7%93%D7%AA-%D7%94%D7%A9%D7%A8%D7%99%D7%9D-%D7%9C%D7%A2%D7%A0%D7%99%D7%99%D7%A0%D7%99-%D7%97%D7%A7%D7%99%D7%A7%D7%94
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4` (2822ms, returned=10, kept=6)
  - canonical: `בג״ץ 4769/24 משמר הדמוקרטיה הישראלית ואח׳ נ׳ ועדת השרים לענייני חקיקה ואח׳`
  - summary: פסק דין/החלטה של בית המשפט העליון בבג״ץ 4769/24, שעסק בהודעת הממשלה על רצונה להחיל דין רציפות על הצעת חוק שירות ביטחון (תיקון מס' 26) (שילוב תלמידי ישיבות).
  - citations: https://www.toledano.co.il/wp-content/uploads/2024/01/%D7%A4%D7%A1%D7%A7-%D7%93%D7%99%D7%9F-%D7%91%D7%99%D7%98%D7%95%D7%9C-%D7%A2%D7%99%D7%9C%D7%AA-%D7%A1%D7%91%D7%99%D7%A8%D7%95%D7%AA-%D7%A2%D7%9C-%D7%99%D7%93%D7%99-%D7%91%D7%92%D7%A5-%D7%92%D7%A8%D7%A1%D7%94-%D7%9E%D7%9C%D7%90%D7%94.pdf, https://main.knesset.gov.il/About/Departments/pages/leg/ldjustice2.aspx, https://www.idi.org.il/articles/63090, https://ynet-pic1.yit.co.il/picserver6/wcm_upload_files/2025/01/08/HJj00oto8Je/____5819_24________________________________________.pdf, https://main.knesset.gov.il/About/Departments/LDResponses/21.10.25%2012.pdf, https://www.idi.org.il/media/28708/separate-representation-is-not-separate-consultation-review-updated-to-july-2025.pdf
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4` (2796ms, returned=9, kept=9)
  - canonical: `בג"ץ 4769/24 משמר הדמוקרטיה הישראלית נ' ועדת השרים לענייני חקיקה`
  - summary: המקור הוא פסק הדין של בית המשפט העליון בבג"ץ 4769/24, שבו העותרות הן משמר הדמוקרטיה הישראלית ופורום איילון לזכויות אדם ולזכויות חברתיות. במסמכי הכנסת מופיעה הכותרת המלאה של ההליך כעתירה בעניין הודעת הממשלה על רצונה להחיל דין רציפות על הצעת 
  - citations: https://ynet-pic1.yit.co.il/picserver6/wcm_upload_files/2025/01/08/HJj00oto8Je/____5819_24________________________________________.pdf, https://main.knesset.gov.il/About/Departments/pages/leg/ldjustice2.aspx, https://img.mako.co.il/2025/11/19/fvvfav.pdf, https://he.afiklaw.com/caselaw/21075, https://main.knesset.gov.il/About/Departments/LDResponses/21.10.25%2012.pdf, https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4

### 9. ע"פ 7939/10  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C10%2F390%2F079%5Cw53&fileName=10079390_w53.txt&type=2` (2063ms, returned=10, kept=10)
  - canonical: `פסק-דין בתיק ע"פ 7939/10`
  - summary: פסק הדין של בית המשפט העליון בע"פ 7939/10, הידוע כעניין זדורוב נ' מדינת ישראל, ניתן ביום 23.12.2015.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C16%2F290%2F013%2Fc03&fileName=16013290.c03&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C17%5C080%5C033%5Cf24&fileName=17033080.F24&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F15%2F090%2F041%2Fl07&fileName=15041090_l07.txt&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F17%2F080%2F033%2Ff24&fileName=17033080.F24&type=2, https://www.psakdin.co.il/Court/%D7%A2-%D7%A4-7939-10
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C10%5C390%5C079%5Cw53&fileName=10079390_w53.txt&type=2` (2481ms, returned=8, kept=5)
  - canonical: `בבית המשפט העליון בשבתו כבית משפט לערעורים פליליים ע"פ 7939/10 לפני: כבוד השופט י' דנציגר כבוד השופט י' עמית כבוד השופט צ' זילברטל המערער: רומן זדורוב נ ג ד המשיבה: מדינת ישראל ערעור על פסק דינו של בית המשפט המחוזי בנצרת בתפ"ח 502/07 מיום 14.9.2010 (סגן הנשיא יצחק כהן והשופטים חיים גלפז ז"ל ואסתר הלמן);`
  - summary: פסק דין של בית המשפט העליון בערעור פלילי 7939/10 בעניין רומן זדורוב נגד מדינת ישראל, מיום 23.12.2015.
  - citations: https://www.yaromadv.co.il/assets/zadorov-court-decision9.pdf, https://www.odonline.co.il/%D7%A2%D7%95-%D7%93-%D7%90%D7%95%D7%9F-%D7%9C%D7%99%D7%99%D7%9F-%D7%A2%D7%95%D7%A8%D7%9B%D7%99-%D7%93%D7%99%D7%9F-%D7%A4%D7%A1%D7%A7%D7%99-%D7%93%D7%99%D7%9F-%D7%A4%D7%A1%D7%A7-%D7%93%D7%99%D7%9F-7939-11.html, https://www.toledano.co.il/category/%D7%A4%D7%A1%D7%99%D7%A7%D7%94-%D7%97%D7%99%D7%A0%D7%9D/page/337/, https://www.psakdin.co.il/Court/%D7%A2-%D7%A4-7939-10, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C10%5C390%5C079%5Cw53&fileName=10079390_w53.txt&type=2, https://www.gov.il/he/departments/dynamiccollectors/spokmanship_court
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C10%5C390%5C079%5Cw53&fileName=10079390_w53.txt&type=2` (2402ms, returned=8, kept=8)
  - canonical: `ע"פ 7939/10 רומן זדורוב נ' מדינת ישראל, פסק-דין מיום 23.12.2015, בית המשפט העליון בשבתו כבית משפט לערעורים פליליים.`
  - summary: פסק הדין בערעור הפלילי של רומן זדורוב, שבו נדון ערעורו על הרשעתו ברצח תאיר ראדה; הערעור נדחה ברוב דעות.
  - citations: https://www.yaromadv.co.il/assets/zadorov-court-decision9.pdf, https://www.toledano.co.il/category/%D7%A4%D7%A1%D7%99%D7%A7%D7%94-%D7%97%D7%99%D7%A0%D7%9D/page/337/, https://www.law.co.il/computer-law/computer-crime/, https://www.psakdin.co.il/Court/%D7%A2-%D7%A4-7939-10, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C10%5C390%5C079%5Cw53&fileName=10079390_w53.txt&type=2, https://www.gov.il/he/departments/dynamiccollectors/spokmanship_court

### 10. בש"פ 5743/21  
_type: case_

- **A** — ❌ `—` (2238ms, returned=0, kept=0)
  - summary: לא אותר מקור אמין עבור בש"פ 5743/21 על סמך המידע הזמין.
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C21%5C430%5C057%5Cf03&fileName=21057430.F03&type=2` (2429ms, returned=6, kept=1)
  - canonical: `בש"פ 5743/21`
  - summary: המקור הוא החלטה בתיק בש"פ 5743/21 של בית המשפט העליון. המסמך זמין באתר פסקי הדין של בתי המשפט בישראל.
  - citations: https://www.youtube.com/watch?v=TA3quRPQZE0, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C21%5C430%5C057%5Cf03&fileName=21057430.F03&type=2, https://13tv.co.il/news/hamakor/, https://www.dinrega.com/gs/%D7%A2%D7%A8%D7%A8%20%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94%20%D7%A2%D7%9C%20%D7%A9%D7%97%D7%A8%D7%95%D7%A8%20%D7%9E%D7%A9%D7%99%D7%91%20%D7%9C%D7%9E%D7%A2%D7%A6%D7%A8%20%D7%91%D7%99%D7%AA%20%D7%9E%D7%9C%D7%95%D7%95%D7%94%20%D7%91%D7%90%D7%99%D7%96%D7%95%D7%A7%20%D7%90%D7%9C%D7%A7%D7%98%D7%A8%D7%95%D7%A0%D7%99, https://www.law.co.il, https://www.makorrishon.co.il
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C21%5C430%5C057%5Cf03&fileName=21057430.F03&type=2` (2145ms, returned=7, kept=7)
  - canonical: `בש"פ 5743/21`
  - summary: החלטה בתיק בש"פ 5743/21, מאת בית המשפט העליון. המקור הראשוני זמין במאגר פסקי הדין של הרשות השופטת.
  - citations: https://main.knesset.gov.il/pages/default.aspx, https://law.haifa.ac.il/wp-content/uploads/2021/11/11L.htm, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C21%5C430%5C057%5Cf03&fileName=21057430.F03&type=2, https://13tv.co.il/news/hamakor/, https://www.dinrega.com/gs/%D7%A2%D7%A8%D7%A8%20%D7%94%D7%9E%D7%93%D7%99%D7%A0%D7%94%20%D7%A2%D7%9C%20%D7%A9%D7%97%D7%A8%D7%95%D7%A8%20%D7%9E%D7%A9%D7%99%D7%91%20%D7%9C%D7%9E%D7%A2%D7%A6%D7%A8%20%D7%91%D7%99%D7%AA%20%D7%9E%D7%9C%D7%95%D7%95%D7%94%20%D7%91%D7%90%D7%99%D7%96%D7%95%D7%A7%20%D7%90%D7%9C%D7%A7%D7%98%D7%A8%D7%95%D7%A0%D7%99, https://www.law.co.il

### 11. מ"ח 6881/19  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4` (2278ms, returned=8, kept=8)
  - canonical: `החלטה בתיק מ"ח 6881/19, מ"ח 6881/19 רומן זדורוב נ' מדינת ישראל ואח' (בית המשפט העליון)`
  - summary: ההחלטה עוסקת בבקשה למשפט חוזר של רומן זדורוב, כולל בקשה לתפיסת תיק רפואי ותוספת לבקשה. מקור ראשוני מבית המשפט העליון.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck04&fileName=19068810.K04&type=4, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck05&fileName=19068810.K05&type=4, https://lite.takdin.co.il/search-results?t=%D7%99%D7%A8%D7%95%D7%9D+%D7%94%D7%9C%D7%95%D7%99&pn=5, https://lite.takdin.co.il/%D7%90%D7%9E%D7%A8%D7%AA%20%D7%90%D7%92%D7%91_page2.html, https://lite.takdin.co.il/%D7%A8%D7%95%D7%9E%D7%9F%20%D7%96%D7%93%D7%95%D7%A8%D7%95%D7%91_page3.html
- **B** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4` (2398ms, returned=10, kept=4)
  - canonical: `בבית המשפט העליון מ"ח 6881/19 לפני: כבוד המשנה לנשיאה (בדימ') ח' מלצר המבקש: רומן זדורוב נ ג ד המשיבה 1: מדינת ישראל המשיבה 2: פלונית (א"ק) המשיב 3: המרכז לבריאות הנפש "מזרע" החלטה`
  - summary: החלטה של בית המשפט העליון בבקשה למשפט חוזר בעניינו של רומן זדורוב, שניתנה בתיק מ"ח 6881/19.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4, https://www.yaromadv.co.il/assets/zadorov-court-decision9.pdf, https://he.afiklaw.com/caselaw/12351, https://skiramishpatit.com/wp-content/uploads/688119.pdf, https://www.dinrega.com/gs/%D7%91%D7%A7%D7%A9%D7%94%20%D7%9C%D7%93%D7%99%D7%95%D7%9F%20%D7%A0%D7%95%D7%A1%D7%A3%20%D7%91%D7%94%D7%A8%D7%A9%D7%A2%D7%AA%20%D7%96%D7%93%D7%95%D7%A8%D7%95%D7%91%20%D7%91%D7%A8%D7%A6%D7%97%20%D7%AA%D7%90%D7%99%D7%A8%20%D7%A8%D7%90%D7%93%D7%94, https://www.idi.org.il/media/17038/retrial-in-israel-a-need-for-reform.pdf
- **C** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4` (2465ms, returned=10, kept=10)
  - canonical: `בבית המשפט העליון
מ"ח 6881/19
לפני: כבוד המשנה לנשיאה (בדימ') ח' מלצר
המבקש: רומן זדורוב
נ ג ד
המשיבה 1: מדינת ישראל
המשיבה 2: פלונית (א"ק)
המשיב 3: המרכז לבריאות הנפש "מזרע"`
  - summary: החלטה בבקשה למשפט חוזר בעניינו של רומן זדורוב. מדובר בהחלטה של בית המשפט העליון בתיק מ"ח 6881/19, שניתנה ע"י המשנה לנשיאה (בדימ') ח' מלצר.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C19%5C810%5C068%5Ck73&fileName=19068810.K73&type=4, https://www.yaromadv.co.il/assets/zadorov-court-decision9.pdf, https://he.afiklaw.com/caselaw/12351, http://img.mako.co.il/2021/05/11/190688103.docx, https://skiramishpatit.com/wp-content/uploads/688119.pdf, https://www.dinrega.com/gs/%D7%91%D7%A7%D7%A9%D7%94%20%D7%9C%D7%93%D7%99%D7%95%D7%9F%20%D7%A0%D7%95%D7%A1%D7%A3%20%D7%91%D7%94%D7%A8%D7%A9%D7%A2%D7%AA%20%D7%96%D7%93%D7%95%D7%A8%D7%95%D7%91%20%D7%91%D7%A8%D7%A6%D7%97%20%D7%AA%D7%90%D7%99%D7%A8%20%D7%A8%D7%90%D7%93%D7%94

### 12. ע"א 9308/20  
_type: case_

- **A** — ✅ `https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F20%2F080%2F093%2Ff16&fileName=20093080.F16&type=4` (2304ms, returned=8, kept=8)
  - canonical: `ע"א 9308/20 פקיד שומה עכו נ' בית חוסן בע"מ`
  - summary: פסק דין של בית המשפט העליון שניתן ביום 13.2.2023, העוסק בתוצאות המס של רכישה עצמית דיספרופורציונית של מניות.
  - citations: https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F22%2F500%2F005%2Fp14&fileName=22005500.P14&type=5, https://www.psakdin.co.il/Court/%D7%A2-%D7%9E-8248-12-21-%D7%A1%D7%95%D7%A4%D7%A8-%D7%95%D7%90%D7%97-%D7%A0-%D7%9E%D7%93%D7%99%D7%A0%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C, https://lite.takdin.co.il/search-results?t=%D7%90.+%D7%90%D7%91%D7%95+%D7%97%D7%A6%D7%99%D7%A8%D7%94, https://lite.takdin.co.il/%D7%91%D7%99%D7%AA%20%D7%97%D7%95%D7%A1%D7%9F_page5.html, https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F22%2F030%2F046%2Fn06&fileName=22046030.N06&type=2, https://lite.takdin.co.il/document/7988383/%D7%A2%D7%9E-%D7%91%D7%90%D7%A8-%D7%A9%D7%91%D7%A2-52828-01-20---%D7%A9%D7%9E%D7%A2%D7%95%D7%9F-%D7%90%D7%9C%D7%99%D7%94%D7%95-%D7%92%D7%95%D7%96%D7%9C%D7%9F-%D7%95%D7%90%D7%97-%D7%A0-%D7%A4%D7%A7%D7%99%D7%93-%D7%A9%D7%95%D7%9E%D7%94-%D7%91%D7%90%D7%A8-%D7%A9%D7%91%D7%A2
- **B** — ✅ `https://www.gov.il/he/pages/law9308-20` (2384ms, returned=9, kept=1)
  - canonical: `ע"א 9308/20 פקיד שומה עכו נ' בית חוסן בע"מ`
  - summary: פסק דין של בית המשפט העליון בעניין מיסוי רכישה עצמית של מניות, הנוגע לשאלת סיווג התמורה והאם נוצרת חבות מס לבעלי המניות הנותרים.
  - citations: https://he.afiklaw.com/caselaw/15243, https://arnontl.com/he/news/%D7%9E%D7%99%D7%A1%D7%95%D7%99-%D7%A8%D7%9B%D7%99%D7%A9%D7%94-%D7%A2%D7%A6%D7%9E%D7%99%D7%AA-%D7%9E%D7%A0%D7%99%D7%95%D7%AA/, https://www.gov.il/he/pages/law9308-20, https://meitar.com/wp-content/uploads/2024/04/Supreme-Court-of-Israel-%E2%80%93-Share-Buyback-by-Kind-of-a-Partnership-Company-Will-Be-Classified-for-Tax-Purposes-as-a-Dividend-By-the-Shareholders.pdf, https://elmekiesse-tax.co.il/%D7%AA%D7%90%D7%92%D7%99%D7%93%D7%99%D7%9D-%D7%93%D7%99%D7%91%D7%99%D7%93%D7%A0%D7%93-%D7%A8%D7%95%D7%95%D7%97-%D7%94%D7%95%D7%9F-%D7%A8%D7%9B%D7%99%D7%A9%D7%94-%D7%A2%D7%A6%D7%9E%D7%99/, https://zes.co.il/%D7%A8%D7%9B%D7%99%D7%A9%D7%94-%D7%A2%D7%A6%D7%9E%D7%99%D7%AA-%D7%9C%D7%90-%D7%A9%D7%95%D7%95%D7%99%D7%95%D7%A0%D7%99%D7%AA-%D7%A9%D7%9C-%D7%9E%D7%A0%D7%99%D7%95%D7%AA/
- **C** — ✅ `https://www.gov.il/he/pages/law9308-20` (2122ms, returned=7, kept=7)
  - canonical: `ע"א 9308/20 פקיד שומה עכו נ' בית חוסן בע"מ`
  - summary: פסק דין של בית המשפט העליון (ירושלים) בעניין מיסוי רכישה עצמית של מניות; עסק בתוצאות המס של רכישה עצמית דיספרופורציונית ובשאלה האם נוצרת הכנסה/דיבידנד לבעלי המניות הנותרים.
  - citations: https://he.afiklaw.com/caselaw/15243, https://arnontl.com/he/news/%D7%9E%D7%99%D7%A1%D7%95%D7%99-%D7%A8%D7%9B%D7%99%D7%A9%D7%94-%D7%A2%D7%A6%D7%9E%D7%99%D7%AA-%D7%9E%D7%A0%D7%99%D7%95%D7%AA/, https://www.gov.il/he/pages/law9308-20, https://meitar.com/wp-content/uploads/2024/04/Supreme-Court-of-Israel-%E2%80%93-Share-Buyback-by-Kind-of-a-Partnership-Company-Will-Be-Classified-for-Tax-Purposes-as-a-Dividend-By-the-Shareholders.pdf, https://www.amir-cpa.net/post/%D7%9E%D7%95%D7%AA%D7%94-%D7%A9%D7%9C-%D7%94%D7%A8%D7%9B%D7%99%D7%A9%D7%94-%D7%94%D7%A2%D7%A6%D7%9E%D7%99%D7%AA-%D7%A4%D7%A1%D7%99%D7%A7%D7%AA-%D7%94%D7%A2%D7%9C%D7%99%D7%95%D7%9F-%D7%9E%D7%A4%D7%91%D7%A8%D7%95%D7%90%D7%A8-2023, https://www.capitax.co.il/Attachments/9308-20.pdf

### 13. פאינה מילמן-סיון ויאיר שגיא "ציבוריות כלאיים: כליאה ציבורית ותעסוקה פרטית בישראל"  
_type: article_

- **A** — ❌ `—` (2140ms, returned=0, kept=0)
  - summary: לא נמצא מקור ראשוני/אקדמי מאומת עבור 'פאינה מילמן-סיון ויאיר שגיא "ציבוריות כלאיים: כליאה ציבורית ותעסוקה פרטית בישראל"'.
- **B** — ✅ `https://www.taulawreview.sites.tau.ac.il/mkh-2/miliman` (2544ms, returned=2, kept=2)
  - canonical: `פאינה מילמן סיון ויאיר שגיא, "ציבוריות כלאיים: כליאה ציבורית ותעסוקה פרטית בישראל", עיוני משפט מח(2) (2025).`
  - summary: מאמר העוסק בתעסוקת אסירים בישראל, הבוחן את המעבר ממסגרת ציבורית בעיקרה למודל היברידי-כלאי המשלב רכיבים ציבוריים ופרטיים, על רקע חשיבה ניאו-ליברלית ופערים בין הדין למציאות.
  - citations: https://www.taulawreview.sites.tau.ac.il/mkh-2/miliman, https://www.taulawreview.sites.tau.ac.il/mkh-2
- **C** — ✅ `https://www.taulawreview.sites.tau.ac.il/mkh-2/miliman` (2368ms, returned=8, kept=8)
  - canonical: `פאינה מילמן-סיון ויאיר שגיא, "ציבוריות כלאיים: כליאה ציבורית ותעסוקה פרטית בישראל", עיוני משפט (טרם פורסם).`
  - summary: המקור נמצא בעמוד מאמר ב-TauLawReview, המציג את הכותרת, המחברים ותאריך הפרסום 24.11.2025. בעמוד מצוין שמדובר במאמר על תעסוקת אסירים בישראל ובהיבטים הציבוריים-פרטיים של התחום.
  - citations: https://lawjournal.huji.ac.il/sites/default/files/2025-02/%D7%A4%D7%90%D7%99%D7%A0%D7%94%20%D7%9E%D7%99%D7%9C%D7%9E%D7%9F-%D7%A1%D7%99%D7%95%D7%9F.pdf, https://www.taulawreview.sites.tau.ac.il/mkh-2/miliman, https://kolhamada.isf.org.il/article/%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D-%D7%9E%D7%90%D7%97%D7%95%D7%A8%D7%99-%D7%94%D7%A1%D7%95%D7%A8%D7%92%D7%99%D7%9D/, https://www.youtube.com/watch?v=QfGtVTaMDpM, https://www.gov.il/BlobFolder/dynamiccollectorresultitem/roimshabas_28/he/28.pdf, https://www.taulawreview.sites.tau.ac.il/mkh-2

### 14. הילה גפן-שפיץ "זוג או פרט? על הפרטה וביזור של רישום זוגיות בין ידועים־בציבור"  
_type: article_

- **A** — ❌ `—` (1835ms, returned=0, kept=0)
  - summary: לא נמצא מקור תואם בחיפושים שסופקו.
- **B** — ✅ `https://www.taulawreview.sites.tau.ac.il/mt-2/hila-geffen-spitz` (2207ms, returned=6, kept=2)
  - canonical: `הילה גפן-שפיץ, "זוג או פרט? על הפרטה וביזור של רישום זוגיות בין ידועים־בציבור"`
  - summary: מאמר שפורסם ב'עיוני משפט' מאת הילה גפן-שפיץ, העוסק בהפרטה ובביזור של רישום זוגיות בין ידועים־בציבור ובתופעת מרשמי זוגיות חלופיים.
  - citations: https://sites.biu.ac.il/cjdl/page/2119, https://www.taulawreview.sites.tau.ac.il/mt-2/hila-geffen-spitz, https://www.globes.co.il/news/article.aspx?did=1001481430, https://www.sapir.ac.il/event/5101, https://heb.hartman.org.il/wp-content/uploads/2024/01/%D7%9B%D7%9C-%D7%97%D7%AA%D7%9F-%D7%95%D7%9B%D7%9C-%D7%9B%D7%9C%D7%94-%D7%97%D7%95%D7%91%D7%A8%D7%AA-screen.pdf, https://www.youtube.com/watch?v=ZZlN-gd0h1I
- **C** — ✅ `https://www.taulawreview.sites.tau.ac.il/mt-2/hila-geffen-spitz` (2368ms, returned=6, kept=6)
  - canonical: `הילה גפן-שפיץ, "זוג או פרט? על הפרטה וביזור של רישום זוגיות בין ידועים־בציבור", עיוני משפט (1.1.2026).`
  - summary: המקור הוא מאמר של הילה גפן-שפיץ בכתב העת 'עיוני משפט', שכותרתו עוסקת בהפרטה ובביזור של רישום זוגיות בין ידועים־בציבור.
  - citations: https://sites.biu.ac.il/cjdl/page/2119, https://www.taulawreview.sites.tau.ac.il/mt-2/hila-geffen-spitz, https://www.globes.co.il/news/article.aspx?did=1001481430, https://www.sapir.ac.il/event/5101, https://heb.hartman.org.il/wp-content/uploads/2024/01/%D7%9B%D7%9C-%D7%97%D7%AA%D7%9F-%D7%95%D7%9B%D7%9C-%D7%9B%D7%9C%D7%94-%D7%97%D7%95%D7%91%D7%A8%D7%AA-screen.pdf, https://www.youtube.com/watch?v=ZZlN-gd0h1I
