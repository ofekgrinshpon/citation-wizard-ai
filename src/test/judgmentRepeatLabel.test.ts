import {describe,it,expect} from 'vitest';
import {extractShortSourceLabel,buildCompoundFootnotes,isLegislationText} from '../../supabase/functions/_shared/footnoteOccurrences.ts';
const title='פסק דין בעניין «מסכת אחת של מעשים» ופיצוי סטטוטורי לפי חוק זכות יוצרים';
const judgment={source_id:'judgment',full_citation:title+' https://example.org/judgment.pdf'};
const law={source_id:'law',full_citation:'חוק זכות יוצרים, התשס״ח-2007'};
const other={source_id:'other',full_citation:'מקור נוסף'};
describe('judgment repeat labels',()=>{
 it('retains descriptive judgment identity',()=>{expect(isLegislationText(title)).toBe(false);expect(extractShortSourceLabel(title)).toBe(title)});
 it('keeps judgment label and backlink after mixed note',()=>{const n=buildCompoundFootnotes([[law],[other],[law,judgment],[judgment]]);expect(n[3].citation).toBe(`${title}, לעיל ה"ש 3.`);expect(n[3].source_id).toBe('judgment');expect(n[3].first_occurrence).toBe(3);expect(n[2].sources.map(s=>s.source_id)).toEqual(['law','judgment'])});
 it('keeps descriptive label on nonadjacent solo repeat',()=>{const n=buildCompoundFootnotes([[judgment],[other],[judgment]]);expect(n[2].citation).toBe(`${title}, לעיל ה"ש 1.`)});
 it('preserves genuine legislation labels',()=>{for(const t of ['חוק זכות יוצרים','פקודת הנזיקין','תקנות סדר הדין','צו הפיקוח על מצרכים'])expect(extractShortSourceLabel(t+", ס' 3")).toBe(t)});
 it('preserves quoted legislation labels',()=>{expect(extractShortSourceLabel('"חוק החוזים, ס\' 3')).toBe('חוק החוזים')});
 it('preserves parsed judgment parties',()=>{expect(extractShortSourceLabel('ע״א 123/24 כהן נ׳ לוי, (2024)')).toBe('עניין לוי')});
 it('preserves adjacent ibid',()=>{expect(buildCompoundFootnotes([[judgment],[judgment]])[1].citation).toBe('שם.')});
 it('preserves legislation section repeats',()=>{expect(buildCompoundFootnotes([[law],[other],[{...law,locator:'סעיף 56'}]])[2].citation).toBe("ס' 56 לחוק זכות יוצרים.")});
});
