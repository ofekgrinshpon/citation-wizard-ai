import { Link } from "react-router-dom";
/** Read-only navigation to a known citation request. No request is submitted here. */
export function CitationRequestStatusLink({ requestId }: { requestId?: string | null }) {
  if (!requestId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(requestId)) return null;
  return <Link to={`/citation-recovery?requestId=${encodeURIComponent(requestId)}`}
    className="inline-block text-xs text-primary underline underline-offset-2">
    בדיקת מצב הבקשה
  </Link>;
}
