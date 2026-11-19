import { buildPastedCitation, isBareDocketOnly } from "../_shared/pastedCitation.ts";
import { escapeCitationLiteral, citationTextOnly } from "../_shared/citationPure/segments.ts";

const ASK = "מספר תיק לבדו אינו מזהה מדינה או הליך באופן חד־משמעי. נא להוסיף את סוג ההליך, בית המשפט או שמות הצדדים.";
/** Read-only existing catalog, not a global case index. A unique catalog hit is
 * only a candidate to confirm, never automatic jurisdiction/identity evidence. */
export async function resolveNeutralDocket(raw: string, lookup: (docket: string) => Promise<unknown>): Promise<string> {
  const preserved = `${escapeCitationLiteral(raw)}\n⚠️ ${ASK}`;
  if (!isBareDocketOnly(raw)) return preserved;
  const docket = raw.trim();
  try {
    const rows = await lookup(docket);
    if (!Array.isArray(rows) || rows.length >= 21) return preserved;
    const exact = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || row.verification_status !== "verified" ||
          typeof row.full_citation !== "string" || row.full_citation.length > 1500 ||
          !["case_law_published", "case_law_database", "caselaw", "פסיקה", "פסיקה (מאגר)", "פסיקה (פד\"י)", "foreign_case_us", "foreign_case_other"].includes(row.source_type)) continue;
      const text = citationTextOnly(row.full_citation);
      // Exact numerical token boundaries reject suffix/prefix and multi-docket records.
      const numbers = text.match(/\d+(?:[\/\-–]\d+)+/g) ?? [];
      if (numbers.length !== 1 || numbers[0] !== docket || /[\n\r<>]|⚠️|\[חסר:/.test(text)) continue;
      if (!/(?:\sנ['׳״]?\s|\sנגד\s|\sv(?:s)?\.?\s)/i.test(text)) continue;
      const parsed = buildPastedCitation(text);
      if (parsed.sourceKind !== "case" || parsed.jurisdiction === "UNKNOWN" || parsed.conflicts.length || parsed.unsupported.length ||
          !parsed.evidence.some(e => ["prefix", "court", "reporter"].includes(e.signal))) continue;
      exact.add(text.trim().replace(/\s+/g, " "));
    }
    if (!exact.size || exact.size > 3) return preserved;
    if (exact.size > 1) return `${preserved}\nבמאגר המאומת נמצאו כמה התאמות אפשריות בלבד:\n${[...exact].sort().map(text => `• ${escapeCitationLiteral(text)}`).join("\n")}\nנא לשלוח את סוג ההליך ושמות הצדדים של פסק הדין המבוקש.`;
    return `${preserved}\nבמאגר המאומת נמצאה התאמה אפשרית בלבד: ${escapeCitationLiteral([...exact][0])}\nאם זה פסק הדין המבוקש, יש לשלוח את סוג ההליך ושמות הצדדים כדי להמשיך.`;
  } catch { return preserved; }
}
