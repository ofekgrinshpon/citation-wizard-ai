import { describe, expect, it } from 'vitest';
import { createHebrewArticleRequest, resolveHebrewArticle, renderHebrewArticle, articleIdentityMatches, isCompleteHebrewArticle } from '../../supabase/functions/_shared/hebrewArticleEvidence';

describe('supplied Hebrew article title preservation', () => {
  const titles = [
    'שנת המשפט בישראל: עיון ביקורתי',
    'מעמוד לעמוד: קריאה מחודשת במשפט',
    'כרך חדש במשפט: עיון ביקורתי',
    '"אני מחליט עליי" — פרטיות של ילדים בעידן הדיגיטלי והזכות לחזרה מהסכמה הורית',
    'פיצוי נאות: על סעדים וצדק בדיני הנטילה השלטונית בישראל',
    'חופש ביטוי ומחאה בקמפוסים בישראל: בין המשפט החוקתי להסדרה עצמית',
    '“גבולות ההסכמה” — עיון מחודש: זכויות ילדים במשפט',
    'זכויות ומוסדות: בחינה של היחסים בין המשפט לבין החברה ובין הפרט לבין המדינה מנקודת מבט ביקורתית חדשה',
  ];
  it.each(titles)('keeps the entire supplied title without evidence: %s', title => {
    const request = createHebrewArticleRequest(title);
    const result = resolveHebrewArticle(request, []);
    expect(result.fields).toEqual({ articleTitle: title });
    expect(result.matched).toBe(false);
    expect(isCompleteHebrewArticle(result)).toBe(false);
    const rendered = renderHebrewArticle(result);
    expect(rendered).toContain(title);
    expect(rendered).not.toContain('[חסר: שם המאמר]');
    for (const field of ['מחבר', 'כתב עת', 'עמוד ראשון', 'שנה']) expect(rendered).toContain(`[חסר: ${field}]`);
  });
  it('retains straight inner quotes in the displayed title without deleting text', () => {
    const title = '"בחירה" — הסכמה וחירות: מבט חדש';
    const rendered = renderHebrewArticle(resolveHebrewArticle(createHebrewArticleRequest(title), []));
    // The existing Hebrew citation renderer uses literal quotation marks, not
    // Markdown delimiters. Outer citation quotes do not remove the inner pair.
    expect(rendered).toContain(`"${title}"`);
    expect(rendered).not.toContain('\\"');
  });
  it('keeps an actual numeric pinpoint out of the bare-title branch', () => {
    expect(createHebrewArticleRequest('זכויות ילדים בעמוד 23').supplied.articleTitle).toBeUndefined();
    expect(createHebrewArticleRequest('זכויות ילדים בעמוד 23').pinpoint).toBe('23');
  });
  it('unwraps only a quotation pair around the whole title', () => {
    expect(createHebrewArticleRequest('"זכויות ומוסדות: עיון מחדש"').supplied.articleTitle).toBe('זכויות ומוסדות: עיון מחדש');
  });
  it('rejects a shorter-title donor rather than filling unrelated metadata', () => {
    const request = createHebrewArticleRequest(titles[0]);
    expect(articleIdentityMatches(request, {articleTitle:'אני מחליט עליי',author:'מחבר אחר'})).toBe(false);
    expect(resolveHebrewArticle(request,[{fields:{articleTitle:'אני מחליט עליי',author:'מחבר אחר',year:'2020'},sourceUrl:'https://example.org',quote:'unrelated'}]).fields).toEqual({articleTitle:titles[0]});
  });
  it('keeps explicit labels and their complete title', () => {
    expect(createHebrewArticleRequest('מחבר: יעל כהן; שם המאמר: זכויות: "עיון" מחודש; כתב עת: משפטים').supplied).toEqual({author:'יעל כהן',articleTitle:'זכויות: "עיון" מחודש',journalName:'משפטים'});
  });
  it('does not turn incomplete or invalid metadata labels into a title', () => {
    for (const raw of ['שנה: לא ידוע', 'כתב עת: משפטים', 'מחבר: יעל כהן', 'שם המאמר: [חסר: שם המאמר]']) expect(createHebrewArticleRequest(raw).supplied.articleTitle).toBeUndefined();
  });
  it('preserves structured citation and first-record parsing', () => {
    const first='יעל כהן "זכויות: עיון מחודש" משפטים מו 13 (2020)';
    const request=createHebrewArticleRequest(`${first}; מחבר אחר "כותרת אחרת" משפטים נ 33 (2021)`);
    expect(request.supplied).toMatchObject({author:'יעל כהן',articleTitle:'זכויות: עיון מחודש',journalName:'משפטים',firstPage:'13',year:'2020'});
  });
  it('does not mistake natural-language topics or multiple bare inputs for a title', () => {
    expect(createHebrewArticleRequest('המאמר של יעל כהן על זכויות ילדים').supplied).toEqual({author:'יעל כהן'});
    expect(createHebrewArticleRequest('זכויות ילדים; חובות הורים').supplied.articleTitle).toBeUndefined();
    expect(createHebrewArticleRequest('זכויות ילדים\nחובות הורים').supplied.articleTitle).toBeUndefined();
  });
});
