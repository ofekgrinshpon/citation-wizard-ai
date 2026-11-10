/** Turns a Word safety-preflight failure into the reason line shown under the
 * generic "cannot save formatting safely" notice. Returns null when the message
 * carries no information beyond that generic notice. */
const GENERIC = /^לא ניתן לשמור את (?:עיצוב )?ה(?:הערה|אזכור)(?: בבטחה)?$/;

export function styleIssueReason(issue: string | null | undefined): string | null {
  if (!issue) return null;
  const reason = issue
    .trim()
    .replace(/[;.]?\s*(?:ההערה|היא)\s+(?:תישאר|נשארה|תישמר)\s+ללא שינוי\.?$/, "")
    .replace(/[;.\s]+$/, "")
    .trim();
  if (!reason || GENERIC.test(reason.replace(/\s+בבטחה$/, " בבטחה"))) return null;
  return reason;
}
