import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Copy, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormattedCitation } from "@/components/FormattedCitation";
import {
  listCitationRecovery, readCitationRecovery, prepareCitationRecoveryRetry, acknowledgeRecoveredCitation,
  type CitationRecoveryRecord,
} from "@/lib/citationRecoveryApi";
import { retryCitationFunction } from "@/lib/functionError";
import { saveRecoveredCitationHistory } from "@/lib/citationHistorySave";
import {
  citationRecoveryDeadline, citationRecoveryExpired, recoveryInputText, recoveryInputTruncated, recoveryPlainText, renderCitationRecovery,
} from "@/lib/renderCitationRecovery";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const PAGE_SIZE = 20;
const HISTORY_UNCHANGED = "עותק השחזור זמין עד 24 שעות מיצירת הבקשה. פריטים שנשמרו בהיסטוריה אינם נמחקים בתום הזמן הזה.";
const UNKNOWN = "תוצאת הבקשה אינה ידועה ודורשת בירור. ייתכן שכבר נוצל שימוש. החזר שימוש לא אושר. אין לפתוח ניסיון חדש לאותו מקור.";

function refundDescription(record: CitationRecoveryRecord): string {
  // Unknown is never reinterpreted as refunded, even if a malformed response
  // combines an unknown outcome with a successful refund flag.
  if (record.status === "unknown") return "החזר שימוש לא אושר.";
  const receipt = record.refundReceipt;
  if (receipt?.status === "refunded" && receipt.refunded === true &&
      Number.isSafeInteger(receipt.units_refunded) && receipt.units_refunded > 0) {
    return `החזר השימוש אושר: ${receipt.units_refunded} יחידות הוחזרו.`;
  }
  if (receipt?.refunded !== false || receipt.units_refunded !== 0) return "החזר השימוש טרם אושר.";
  if (receipt.status === "retained") return "השימוש הקודם לא הוחזר.";
  if (receipt.status === "not_charged") return "לא נרשם חיוב לבקשה זו.";
  if (receipt.status === "review_required") return "החזר השימוש דורש בירור.";
  if (receipt.status === "not_applicable") return "לא נרשם החזר שימוש לבקשה זו.";
  return "החזר השימוש טרם אושר.";
}

function titleFor(record: CitationRecoveryRecord): string {
  if (record.status === "unknown") return "נדרש בירור";
  if (record.status === "failed") return "הבקשה נכשלה";
  if (record.status === "in_progress") return "הבקשה בטיפול";
  if (citationRecoveryExpired(record)) return "הושלמה · עותק השחזור פג";
  if (record.availability !== "available" || !renderCitationRecovery(record)) return "הושלמה · התוצאה אינה זמינה להצגה";
  return "הושלמה · התוצאה זמינה";
}

function dateLabel(value: string | number): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("he-IL") : "מועד לא זמין";
}

function recoveryError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (/AUTH|ACCOUNT|SESSION|STALE/.test(code)) return "החשבון השתנה או שההתחברות הסתיימה. הנתונים הקודמים הוסתרו. התחברו לחשבון המתאים ובדקו שוב.";
  if (/EXPIRED/.test(code)) return "עותק השחזור פג. אפשר לבדוק את מצב הבקשה, אך לא לשחזר את התוכן. ההיסטוריה השמורה לא השתנתה.";
  return "לא ניתן לבדוק את השחזור כרגע. לא הופעלה בקשת אזכור נוספת. שמרו את מזהה הבקשה ונסו בדיקת מצב ידנית מאוחר יותר.";
}

export default function CitationRecovery() {
  const { user, loading } = useAuth();
  const { currentProject } = useProjects();
  const [routeParams] = useSearchParams();
  const previousAccount = useRef<string | null>(null);
  const accountChanged = useRef(false);
  if (user?.id) {
    if (previousAccount.current && previousAccount.current !== user.id) accountChanged.current = true;
    previousAccount.current = user.id;
  }
  if (loading) return <main dir="rtl" className="p-8" role="status">בודקים את ההתחברות…</main>;
  if (!user) return <main dir="rtl" className="max-w-xl mx-auto p-8 space-y-4">
    <h1 className="text-2xl font-bold">מצב בקשות אזכור</h1>
    <p>יש להתחבר כדי לצפות בבקשות של החשבון שלכם.</p>
    <Link to="/auth" className="text-primary underline">להתחברות</Link>
  </main>;
  // A project/account change unmounts the old view immediately, invalidating
  // every pending read/copy/save/retry before it can deliver old context.
  return <RecoveryWorkspace key={`${user.id}:${currentProject?.id ?? "none"}:${routeParams.get("requestId") ?? ""}`} accountId={user.id} accountChanged={accountChanged.current} />;
}

function RecoveryWorkspace({ accountId, accountChanged }: { accountId: string; accountChanged: boolean }) {
  // The shared project provider can retain the previous account's last list
  // during hydration. Recovery only displays names from an owner-filtered read.
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectError, setProjectError] = useState(false);
  const [searchParams] = useSearchParams();
  const initialId = searchParams.get("requestId") ?? "";
  const [requestId, setRequestId] = useState(initialId.slice(0, 200));
  const [records, setRecords] = useState<CitationRecoveryRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authChanged, setAuthChanged] = useState(accountChanged);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [attemptedParents, setAttemptedParents] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  const accountAllowed = useRef(true);
  const sequence = useRef(0);
  const reading = useRef(false);
  const acting = useRef(false);
  const selectedProject = useRef(projectId);
  selectedProject.current = projectId;

  const isCurrent = useCallback(() => alive.current && accountAllowed.current, []);
  const clearPrivateView = useCallback(() => {
    accountAllowed.current = false;
    sequence.current += 1;
    setRecords([]);
    setNextCursor(null);
    setProjectId("");
    setProjects([]);
    setSaved({});
    setAcknowledged(new Set());
    setNotice(null);
    setAuthChanged(true);
  }, []);
  const checkSession = useCallback(async (current = isCurrent) => {
    if (!current()) throw new Error("RECOVERY_ACCOUNT_CHANGED");
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (!alive.current) throw new Error("RECOVERY_VIEW_STALE");
    if (sessionError || data.session?.user.id !== accountId) {
      clearPrivateView();
      throw new Error("RECOVERY_ACCOUNT_CHANGED");
    }
    if (!current()) throw new Error("RECOVERY_VIEW_STALE");
  }, [accountId, clearPrivateView, isCurrent]);

  useEffect(() => {
    alive.current = true;
    accountAllowed.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== accountId) clearPrivateView();
    });
    return () => { alive.current = false; accountAllowed.current = false; sequence.current += 1; subscription.unsubscribe(); };
  }, [accountId, clearPrivateView]);

  const loadProjects = useCallback(async () => {
    if (!isCurrent()) return;
    setProjectsLoading(true);
    setProjectError(false);
    try {
      await checkSession();
      const { data, error: readError } = await supabase.from("projects")
        .select("id, name").eq("user_id", accountId).order("created_at", { ascending: true });
      await checkSession();
      if (readError || !Array.isArray(data)) throw new Error("RECOVERY_PROJECTS_UNAVAILABLE");
      if (isCurrent()) setProjects(data.filter((project) => typeof project.id === "string" && typeof project.name === "string")
        .map((project) => ({ id: project.id, name: recoveryPlainText(project.name, 500) })));
    } catch {
      if (isCurrent()) { setProjects([]); setProjectError(true); }
    } finally {
      if (alive.current) setProjectsLoading(false);
    }
  }, [accountId, checkSession, isCurrent]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void loadProjects(); });
    return () => { cancelled = true; };
  }, [loadProjects]);

  const load = useCallback(async (id: string | null = null, cursor: string | null = null) => {
    if (reading.current || acting.current || !alive.current) return;
    if (id && !REQUEST_ID.test(id)) { setError("יש להזין מזהה בקשה מלא ותקין."); return; }
    reading.current = true;
    accountAllowed.current = true;
    const turn = ++sequence.current;
    const current = () => isCurrent() && sequence.current === turn;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (!cursor) { setRecords([]); setNextCursor(null); }
    try {
      await checkSession(current);
      const page = id
        ? { requests: await readCitationRecovery(accountId, id, current).then((record) => record ? [record] : []), nextCursor: null }
        : await listCitationRecovery(accountId, { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE }, current);
      await checkSession(current);
      if (!current()) return;
      setRecords((previous) => cursor ? [...previous, ...page.requests.filter((record) => !previous.some((item) => item.requestId === record.requestId))] : page.requests);
      setNextCursor(page.nextCursor);
      setLookupId(id);
      setLoaded(true);
      setAuthChanged(false);
    } catch (failure) {
      if (alive.current && sequence.current === turn) setError(recoveryError(failure));
    } finally {
      reading.current = false;
      if (alive.current && sequence.current === turn) setBusy(false);
      else if (alive.current && !accountAllowed.current) setBusy(false);
    }
  }, [accountId, checkSession, isCurrent]);

  useEffect(() => {
    // Deferring one microtask also makes the mount safe under StrictMode's
    // setup/cleanup/setup cycle without duplicate reads.
    let cancelled = false;
    if (!accountChanged) void Promise.resolve().then(() => {
      if (!cancelled) void load(REQUEST_ID.test(initialId) ? initialId : null);
    });
    // Only the initial route visit loads automatically. No polling/refocus retry.
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Local expiry only: no network/polling. An open tab must not keep offering
  // copy/save/retry of a payload after its original 24-hour deadline.
  useEffect(() => {
    const deadlines = records.filter((record) => record.input || record.result)
      .map(citationRecoveryDeadline).filter((deadline): deadline is number => deadline !== null);
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => setRecords((previous) => previous.map((record) => citationRecoveryExpired(record)
      ? { ...record, availability: "expired", input: null, result: null } : record)), Math.max(0, Math.min(...deadlines) - Date.now()) + 5);
    return () => window.clearTimeout(timer);
  }, [records]);

  const acknowledge = async (record: CitationRecoveryRecord, current = isCurrent) => {
    const rendered = renderCitationRecovery(record);
    if (!rendered || rendered.truncated || !current()) throw new Error("RECOVERY_ACK_UNAVAILABLE");
    await checkSession(current);
    await acknowledgeRecoveredCitation(accountId, record.requestId, current);
    await checkSession(current);
    if (current()) setAcknowledged((previous) => new Set([...previous, record.requestId]));
  };

  const finish = async (record: CitationRecoveryRecord) => {
    if (acting.current || reading.current || !isCurrent()) return;
    acting.current = true; setActiveAction(`ack:${record.requestId}`); setError(null); setNotice(null);
    try {
      await acknowledge(record);
      if (isCurrent()) setNotice("השחזור סומן כהושלם במכשיר הזה. עותק התוצאה וההיסטוריה נשארו ללא שינוי.");
    } catch {
      if (isCurrent()) setError("לא ניתן לאשר שסימון השחזור עודכן. התוצאה עדיין זמינה כאן כל עוד חלון השחזור בתוקף; לא הופעלה בקשת אזכור חדשה.");
    } finally {
      acting.current = false;
      if (alive.current) setActiveAction(null);
    }
  };

  const copy = async (text: string, label: string, record?: CitationRecoveryRecord, acknowledgeResult = true) => {
    if (acting.current || !isCurrent()) return;
    acting.current = true;
    setActiveAction(`copy:${record?.requestId ?? label}`);
    setNotice(null); setError(null);
    let copied = false;
    try {
      await checkSession();
      if (record && citationRecoveryExpired(record)) throw new Error("RECOVERY_EXPIRED");
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(text);
      copied = true;
      await checkSession();
      if (isCurrent()) setNotice(`${label} ${label === "התוצאה" ? "הועתקה" : "הועתק"}.`);
      if (record && acknowledgeResult && !renderCitationRecovery(record)?.truncated && !acknowledged.has(record.requestId)) {
        try { await acknowledge(record); }
        catch { if (isCurrent()) setError("התוצאה הועתקה, אך סימון השחזור לא אושר. אפשר לנסות שוב באמצעות ׳סיימתי לשחזר׳; לא נשלח אזכור חדש."); }
      }
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error && /AUTH|ACCOUNT|STALE|EXPIRED/.test(failure.message)
        ? recoveryError(failure) : copied ? "התוצאה הועתקה, אך לא ניתן לאשר את מצב השחזור." : "ההעתקה לא הצליחה. אפשר לסמן את הטקסט ולהעתיק ידנית.");
    } finally {
      acting.current = false;
      if (alive.current) setActiveAction(null);
    }
  };

  const save = async (record: CitationRecoveryRecord) => {
    const selected = selectedProject.current;
    if (acting.current || !selected || projectsLoading || !projects.some((project) => project.id === selected) || !isCurrent()) return;
    const rendered = renderCitationRecovery(record);
    if (!rendered || rendered.truncated || saved[record.requestId]) return;
    acting.current = true; setActiveAction(`save:${record.requestId}`); setNotice(null); setError(null);
    const current = () => isCurrent() && selectedProject.current === selected;
    try {
      await checkSession(current);
      const result = await saveRecoveredCitationHistory({ requestId: record.requestId, projectId: selected,
        formattedOutput: rendered.formattedOutput, sourceType: rendered.sourceType, expectedAccountId: accountId, isResultCurrent: current });
      await checkSession(current);
      if (!current()) return;
      setSaved((previous) => ({ ...previous, [record.requestId]: result.historyId }));
      setNotice(result.alreadySaved ? "התוצאה כבר שמורה בהיסטוריה. לא נוצר עותק נוסף." : "התוצאה נשמרה בהיסטוריה של הפרויקט שבחרתם.");
      if (!acknowledged.has(record.requestId)) {
        try { await acknowledge(record, current); }
        catch { if (current()) setError("התוצאה שמורה בהיסטוריה, אך סימון השחזור לא אושר. אפשר לנסות שוב באמצעות ׳סיימתי לשחזר׳; אין צורך לשמור עותק נוסף."); }
      }
    } catch (failure) {
      if (current()) setError(failure instanceof Error && /AUTH|ACCOUNT|STALE/.test(failure.message)
        ? recoveryError(failure) : "השמירה לא אושרה. ייתכן שהתגובה אבדה לאחר השמירה; ניסיון שמירה נוסף לא ייצור עותק כפול. אם התוצאה כבר שמורה בפרויקט אחר, היא לא תועבר.");
    } finally {
      acting.current = false;
      if (alive.current) setActiveAction(null);
    }
  };

  const retry = async (record: CitationRecoveryRecord) => {
    if (acting.current || reading.current || record.status !== "failed" || !record.input ||
        record.availability !== "available" || citationRecoveryExpired(record) || !isCurrent()) return;
    acting.current = true; setActiveAction(`retry:${record.requestId}`); setNotice(null); setError(null);
    let dispatched = false;
    try {
      await checkSession();
      // This read refetches authoritative failed status, exact retained input
      // and receipt before granting the explicit new-attempt capability.
      const descriptor = await prepareCitationRecoveryRetry(accountId, record.requestId, isCurrent);
      await checkSession();
      dispatched = true;
      setAttemptedParents((previous) => new Set([...previous, record.requestId]));
      const attempt = await retryCitationFunction<{ requestId?: string }>(descriptor, { isCitationResultCurrent: isCurrent });
      await checkSession();
      const childId = attempt.errorInfo?.requestId || attempt.data?.requestId;
      const page = childId && childId !== record.requestId
        ? { requests: await readCitationRecovery(accountId, childId, isCurrent).then((child) => child ? [child] : []), nextCursor: null }
        : await listCitationRecovery(accountId, { parentRequestId: record.requestId, limit: 1 }, isCurrent);
      await checkSession();
      if (!isCurrent()) return;
      if (page.requests.length) {
        const child = page.requests[0];
        setRecords((previous) => [child, ...previous.filter((item) => item.requestId !== record.requestId && item.requestId !== child.requestId)]);
        setNotice("מצב הניסיון החדש מוצג להלן. התוצאה לא נוספה אוטומטית להיסטוריה או למסמך.");
      } else {
        setNotice(attempt.errorInfo?.isInsufficientCredits
          ? "המכסה הנוכחית אינה מספיקה לניסיון החדש. בדקו את מצב הבקשה לפני פעולה נוספת."
          : `טרם ניתן לאשר את תוצאת הניסיון. שמרו את מזהה הבקשה ובדקו שוב ידנית.${childId ? ` מזהה: ${childId}` : ""}`);
      }
    } catch (failure) {
      if (isCurrent()) setError(dispatched
        ? "לא ניתן לאשר את מצב הניסיון החדש. ייתכן שכבר נוצל שימוש. החזר שימוש לא אושר. שמרו את מזהה הבקשה ובדקו שוב ידנית לפני פעולה נוספת."
        : "לא ניתן להתחיל ניסיון חדש במצב הנוכחי. בדקו שוב את מצב הבקשה; הקלט או חלון השחזור עשויים לא להיות זמינים.");
    } finally {
      acting.current = false;
      if (alive.current) setActiveAction(null);
    }
  };

  return <main className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="space-y-3">
        <Link to="/app" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" /> חזרה לאזכורים</Link>
        <h1 className="text-2xl font-bold">מצב בקשות אזכור</h1>
        <p className="text-sm text-muted-foreground">כאן אפשר לבדוק אזכור שלא התקבל ולפתוח תוצאה שכבר מוכנה, גם אחרי רענון או סגירת העמוד.</p>
        <p className="text-sm">{HISTORY_UNCHANGED}</p>
        <p className="text-sm text-muted-foreground">בדיקה, צפייה והעתקה אינן מתחילות אזכור חדש. המצב מתעדכן רק בלחיצה על רענון.</p>
      </header>
      <div className="flex flex-wrap items-start gap-3">
        <Button type="button" variant="outline" disabled={busy || !!activeAction} onClick={() => void load(lookupId)}><RefreshCw className="h-4 w-4 ml-1" /> רענון מצב</Button>
        {lookupId && <Button type="button" variant="ghost" disabled={busy || !!activeAction} onClick={() => void load(null)}>כל הבקשות</Button>}
        <details className="min-w-0 flex-1 rounded-lg border bg-card p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">איתור בקשה לפי מזהה</summary>
          <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void load(requestId.trim()); }}>
            <label htmlFor="recovery-request-id" className="block text-sm font-medium">מזהה בקשה</label>
            <div className="flex flex-wrap gap-2">
              <Input id="recovery-request-id" dir="ltr" value={requestId} maxLength={200} onChange={(event) => setRequestId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="min-w-0 flex-1" />
              <Button type="submit" disabled={busy || !!activeAction || !requestId.trim()}>בדיקת בקשה</Button>
            </div>
          </form>
        </details>
      </div>
      {busy && <p role="status">בודקים את מצב הבקשות…</p>}
      {authChanged && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">החשבון השתנה או שההתחברות הסתיימה. הנתונים הקודמים הוסתרו. לחצו על רענון כדי לבדוק את החשבון הנוכחי.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-lg border p-4 text-sm">{notice}</p>}
      {!busy && loaded && !authChanged && records.length === 0 && <p role="status" className="rounded-xl border p-6">
        {lookupId ? "הבקשה לא נמצאה בחשבון הנוכחי. אין בכך אישור שלא בוצעה או שלא נוצל שימוש; בדקו את המזהה ושמרו אותו לבירור." : "לא נמצאו בקשות לשחזור בחשבון הנוכחי. ההיסטוריה השמורה לא השתנתה."}
      </p>}
      {!authChanged && records.map((record) => {
        const expired = citationRecoveryExpired(record);
        const rendered = renderCitationRecovery(record);
        const inputText = !expired && citationRecoveryDeadline(record) !== null && record.availability === "available" ? recoveryInputText(record) : "";
        const canRetry = record.status === "failed" && record.availability === "available" && !!record.input &&
          citationRecoveryDeadline(record) !== null && !expired && !attemptedParents.has(record.requestId);
        return <article key={record.requestId} aria-label={`בקשה ${record.requestId}`} className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
          <div className="space-y-2">
            <h2 className="font-semibold text-lg">{titleFor(record)}</h2>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">פרטים נוספים</summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>מזהה בקשה: <bdi>{recoveryPlainText(record.requestId, 200)}</bdi></span>
              <Button type="button" size="sm" variant="ghost" aria-label={`העתקת מזהה ${record.requestId}`} disabled={!!activeAction} onClick={() => void copy(record.requestId, "מזהה הבקשה")}><Copy className="h-3 w-3" /></Button>
            </div>
            {record.retryOfRequestId && <p className="text-xs text-muted-foreground">ניסיון של בקשה קודמת: <bdi>{recoveryPlainText(record.retryOfRequestId, 200)}</bdi></p>}
            <p className="text-xs text-muted-foreground">נוצרה: {dateLabel(record.createdAt)} · עותק השחזור עד: {dateLabel(citationRecoveryDeadline(record) ?? NaN)}</p>
            </details>
          </div>
          {record.status === "in_progress" && <p className="text-sm">הבקשה עדיין בטיפול. ניתן לבדוק שוב באמצעות רענון ידני. לא נפתח ניסיון נוסף.</p>}
          {record.status === "unknown" && <p className="text-sm text-amber-700 dark:text-amber-300">{UNKNOWN}</p>}
          {record.status === "failed" && <p className="text-sm">{refundDescription(record)}</p>}
          {expired && <p className="text-sm">חלפו 24 שעות או שחלון השחזור הסתיים. הקלט והתוצאה אינם זמינים בעותק השחזור. תוצאה שנשמרה בהיסטוריה נשארת שם.</p>}
          {!expired && record.status === "succeeded" && !rendered && <p className="text-sm">הבקשה מסומנת כהושלמה, אך אין כרגע תוצאה שניתן להציג בבטחה. השלמה טכנית אינה הוכחה לאיכות משפטית או לאזכור תקין. אין אישור להחזר או לניסיון חדש.</p>}
          {!expired && record.availability === "unavailable" && <p className="text-sm">עותק התוכן אינו זמין כרגע. אפשר לבדוק שוב ידנית; לא הופעלה בקשה נוספת.</p>}
          {inputText && <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">הקלט שנשמר עם הבקשה</summary>
            <div dir="auto" className="mt-3 whitespace-pre-wrap break-words text-sm max-h-64 overflow-auto">{inputText}</div>
            {recoveryInputTruncated(record) && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">הקלט ארוך ממגבלת התצוגה. מוצגת וניתנת להעתקה רק תחילתו; ניסיון חדש, אם מותר, משתמש בקלט המלא שנשמר בשרת.</p>}
            <Button type="button" size="sm" variant="ghost" disabled={!!activeAction || busy} onClick={() => void copy(inputText, "הקלט המוצג", record, false)}>{recoveryInputTruncated(record) ? "העתקת הקלט המוצג" : "העתקת הקלט"}</Button>
          </details>}
          {rendered && <details className="space-y-3 rounded-lg border p-3">
            <summary className="cursor-pointer font-medium text-primary">הצגת התוצאה</summary>
            <section aria-label="התוצאה ששוחזרה" className="space-y-3">
            <p className="text-xs text-muted-foreground">זוהי התוצאה שנשמרה. היא לא אומתה מחדש ויש לבדוק את המקור והאזכור לפני שימוש.</p>
            <div dir="auto" className="rounded-lg bg-muted/40 p-4 whitespace-pre-wrap break-words max-h-96 overflow-auto" data-testid="recovered-output">
              {rendered.structured ? <FormattedCitation text={rendered.formattedOutput} enableTooltips={false} /> : rendered.formattedOutput}
            </div>
            {rendered.warning && <p className="text-sm text-amber-700 dark:text-amber-300">{rendered.warning}</p>}
            {!rendered.truncated && !saved[record.requestId] && <section aria-label="יעד שמירה בהיסטוריה" className="rounded-xl border bg-card p-4 space-y-2">
              <label htmlFor={`recovery-project-${record.requestId}`} className="block text-sm font-medium">פרויקט לשמירה בהיסטוריה</label>
              <select id={`recovery-project-${record.requestId}`} className="w-full rounded-md border bg-background p-2 text-sm" value={projectId} disabled={projectsLoading} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">בחרו פרויקט במפורש</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">השמירה תתבצע רק בלחיצה על כפתור השמירה של התוצאה. בחירה כאן אינה משנה את הפרויקט הפעיל.</p>
              {projectError && <div className="text-sm space-y-2"><p>לא ניתן לטעון את הפרויקטים של החשבון כרגע. צפייה והעתקה עדיין זמינות.</p>
                <Button type="button" variant="outline" disabled={!!activeAction || busy || projectsLoading} onClick={() => void loadProjects()}>רענון פרויקטים</Button></div>}
              {!projectError && !projectsLoading && projects.length === 0 && <p className="text-sm">אין פרויקט זמין לשמירה. ניתן לחזור לעמוד האזכורים וליצור פרויקט.</p>}
            </section>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!!activeAction || busy} onClick={() => void copy(rendered.plainText, rendered.truncated ? "החלק המוצג" : "התוצאה", record)}><Copy className="h-4 w-4 ml-1" /> {rendered.truncated ? "העתקת החלק המוצג" : "העתקת התוצאה"}</Button>
              <Button type="button" disabled={!!activeAction || busy || !projectId || projectsLoading || rendered.truncated || !!saved[record.requestId]} onClick={() => void save(record)}>
                {saved[record.requestId] ? "נשמר בהיסטוריה" : activeAction === `save:${record.requestId}` ? "שומרים…" : "שמירה בהיסטוריה"}
              </Button>
              {!rendered.truncated && <Button type="button" variant="ghost" disabled={!!activeAction || busy || acknowledged.has(record.requestId)} onClick={() => void finish(record)}>
                {acknowledged.has(record.requestId) ? "השחזור סומן כהושלם" : "סיימתי לשחזר"}
              </Button>}
            </div>
            <p className="text-xs text-muted-foreground">העתקה, שמירה או ׳סיימתי לשחזר׳ מסמנות במכשיר הזה שהתוצאה התקבלה. עותק השחזור נשאר זמין עד מועד התפוגה.</p>
            </section>
          </details>}
          {canRetry && <div className="rounded-lg border border-amber-500/40 p-3 space-y-3">
            <p className="text-sm">ניסיון חדש הוא בקשה נפרדת עם הקלט המקורי, ועשוי לצרוך שימוש נוסף. המכסה הנוכחית תיבדק בשרת. מצב ההחזר הקודם מוצג למעלה.</p>
            <Button type="button" variant="outline" disabled={!!activeAction || busy} onClick={() => void retry(record)}>{activeAction === `retry:${record.requestId}` ? "בודקים ושולחים…" : "ניסיון חדש"}</Button>
          </div>}
          {attemptedParents.has(record.requestId) && <p className="text-sm">כבר התבקש ניסיון חדש. בדקו את מצב הבקשה; אין לפתוח ניסיון חדש נוסף לאותו מקור.</p>}
        </article>;
      })}
      {!authChanged && nextCursor && <Button variant="outline" disabled={busy || !!activeAction} onClick={() => void load(null, nextCursor)}>טעינת בקשות נוספות</Button>}
    </div>
  </main>;
}
