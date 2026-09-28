import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReLexLogo } from "@/components/ReLexLogo";
import { useProjects } from "@/hooks/useProjects";
import { useCredits } from "@/hooks/useCredits";
import { CREDIT_COSTS } from "@/lib/creditCosts";
import { InsufficientCreditsDialog } from "@/components/InsufficientCreditsDialog";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ResearchConversationSidebar } from "./ResearchConversationSidebar";
import { ResearchChatMessage } from "./ResearchChatMessage";
import { ConversationComposer, type ComposerHandle } from "./ConversationComposer";
import {
  ACTIVE_JOB_STATUSES,
  AWAITING_USER,
  createConversation,
  fetchJobState,
  loadConversation,
  resumeClarification,
  sendUserMessage,
  startResearchForMessage,
  trackConversationEvent,
  uploadChatFiles,
  type ConversationRow,
  type JobState,
  type MessageRow,
} from "@/lib/researchConversation";

const POLL_MS = 2000;
const EXAMPLES = [
  "אני כותב סמינריון על חוזים — תציע לי שאלת מחקר",
  "תמצא לי מקורות על הרמת מסך ההתאגדות",
  "מה הדין לגבי חובת תום הלב במשא ומתן?",
];

/** A job's reply has landed when the thread ends with its assistant message. */
function replyLanded(messages: MessageRow[], job: JobState): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.job_id !== job.id) return false;
  return job.status === AWAITING_USER ? last.kind === "clarification" : last.kind !== "clarification";
}

export function ResearchConversationPanel() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const credits = useCredits();

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [job, setJob] = useState<JobState | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [insufficient, setInsufficient] = useState({ open: false, required: CREDIT_COSTS.research, remaining: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const composerRef = useRef<ComposerHandle>(null);
  const pollRef = useRef<number | null>(null);
  const convIdRef = useRef<string | null>(null);

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPoll, []);

  const scrollToBottom = (force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || atBottomRef.current) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  };

  const isActive = !!job && ACTIVE_JOB_STATUSES.includes(job.status);
  const awaitingReply = !!job && job.status === AWAITING_USER;

  /** Reload messages until the job's assistant reply appears (bounded). */
  const settle = useCallback(async (cid: string, j: JobState) => {
    for (let i = 0; i < 6; i++) {
      const { messages: msgs } = await loadConversation(cid);
      if (convIdRef.current !== cid) return;
      setMessages(msgs);
      if (replyLanded(msgs, j)) { setNotice(null); return; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (j.status !== AWAITING_USER && j.status !== "done") {
      setNotice("המחקר לא הושלם בגלל תקלה. אם נוצל שימוש, הוא הוחזר. אפשר לשלוח את ההודעה שוב.");
    }
  }, []);

  const poll = useCallback((cid: string, jobId: string) => {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      const j = await fetchJobState(jobId);
      if (!j || convIdRef.current !== cid) return;
      setJob(j);
      if (!ACTIVE_JOB_STATUSES.includes(j.status)) {
        stopPoll();
        await settle(cid, j);
        setTimeout(() => composerRef.current?.focus(), 0);
      }
    }, POLL_MS);
  }, [settle]);

  // Load the conversation named in the URL (refresh, deep link, sidebar).
  useEffect(() => {
    if (!conversationId) {
      stopPoll();
      convIdRef.current = null;
      setConversation(null);
      setMessages([]);
      setJob(null);
      setNotice(null);
      return;
    }
    if (convIdRef.current === conversationId) return; // just created locally
    convIdRef.current = conversationId;
    stopPoll();
    setNotice(null);
    setLoadingConv(true);
    (async () => {
      const { conversation: c, messages: msgs, latestJob } = await loadConversation(conversationId);
      if (convIdRef.current !== conversationId) return;
      setLoadingConv(false);
      if (!c) { navigate("/app", { replace: true }); return; }
      setConversation(c);
      setMessages(msgs);
      setJob(latestJob);
      atBottomRef.current = true;
      scrollToBottom(true);
      trackConversationEvent("conversation_resumed", { conversation_id: c.id, conversation_messages_count: msgs.length });
      if (latestJob && ACTIVE_JOB_STATUSES.includes(latestJob.status)) poll(c.id, latestJob.id);
      else if (latestJob && !replyLanded(msgs, latestJob) && !latestJob.response_message_id) {
        void settle(c.id, latestJob);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => { scrollToBottom(); }, [messages.length, isActive]);

  const handleSend = async (text: string, files: File[]): Promise<boolean> => {
    if (!text && files.length === 0) return false;
    if (isActive || sending) return false;
    const replying = awaitingReply && !!job;
    if (!replying && !credits.hasEnough(CREDIT_COSTS.research)) {
      setInsufficient({
        open: true,
        required: CREDIT_COSTS.research,
        remaining: Number.isFinite(credits.totalCreditsAvailable) ? credits.totalCreditsAvailable : 0,
      });
      return false;
    }
    setSending(true);
    setNotice(null);
    try {
      let conv = conversation;
      if (!conv) {
        conv = await createConversation(currentProject?.id ?? null);
        convIdRef.current = conv.id;
        setConversation(conv);
        navigate(`/app/chat/${conv.id}`, { replace: !conversationId });
      }
      const attachments = !replying && files.length ? await uploadChatFiles(files) : [];
      const content = text || "מצורף קובץ";
      const msg = await sendUserMessage(conv, content, attachments);
      if (!conv.title) setConversation({ ...conv, title: content.slice(0, 60) });
      setMessages((prev) => [...prev, msg]);
      atBottomRef.current = true;
      scrollToBottom(true);
      const turnIndex = messages.filter((m) => m.role === "user").length + 1;

      if (replying && job) {
        const { errorInfo } = await resumeClarification(job.id, content);
        if (errorInfo) {
          toast.error(errorInfo.message || "לא הצלחנו לשלוח את התשובה. נסו שוב.");
          return true;
        }
        trackConversationEvent("clarification_answered", { conversation_id: conv.id, job_id: job.id, message_id: msg.id, conversation_turn_index: turnIndex });
        const next = { ...job, status: "running", progress_label_he: "חושב..." };
        setJob(next);
        poll(conv.id, job.id);
        return true;
      }

      const { jobId, errorInfo } = await startResearchForMessage({
        conversationId: conv.id,
        message: msg,
        projectId: currentProject?.id ?? conv.project_id ?? null,
        attachments,
      });
      if (errorInfo || !jobId) {
        if (errorInfo?.isInsufficientCredits) {
          await credits.refresh();
          setInsufficient({ open: true, required: errorInfo.required ?? CREDIT_COSTS.research, remaining: 0 });
        } else if (errorInfo?.isOperationInProgress) {
          setNotice(errorInfo.message || "כבר מתבצעת פעולה בחשבון. נסו שוב בעוד רגע.");
        } else {
          setNotice(errorInfo?.message || "לא הצלחנו להתחיל. נסו לשלוח שוב.");
        }
        return true;
      }
      trackConversationEvent("turn_started", {
        conversation_id: conv.id, message_id: msg.id, job_id: jobId, trigger_message_id: msg.id,
        conversation_turn_index: turnIndex, conversation_messages_count: messages.length + 1,
        project_id: conv.project_id,
      });
      setJob({ id: jobId, status: "running", progress_label_he: null, error: null, response_message_id: null, created_at: new Date().toISOString() });
      poll(conv.id, jobId);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה בשליחה");
      return false;
    } finally {
      setSending(false);
    }
  };

  const lastMessage = messages[messages.length - 1];

  return (
    <div className="h-full flex flex-col" dir="rtl">
      <div className="md:hidden flex items-center justify-between pt-2">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <MessageSquare className="w-3.5 h-3.5" />
              שיחות
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="p-0 w-72">
            <ResearchConversationSidebar
              projectId={currentProject?.id ?? null}
              onNavigate={() => setDrawerOpen(false)}
            />
          </SheetContent>
        </Sheet>
        {conversation?.title && (
          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{conversation.title}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto py-4 px-1"
      >
        {loadingConv && messages.length === 0 && (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loadingConv && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-10 px-4">
            <div className="mb-4"><ReLexLogo size={48} /></div>
            <h2 className="text-lg font-bold text-foreground mb-1">במה אפשר לעזור?</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-5">
              שאלו שאלה משפטית, בקשו מקורות, צרפו פסק דין לסיכום או התחילו לעבוד על עבודה אקדמית — פשוט כתבו.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => composerRef.current?.setText(ex)}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground text-right hover:border-primary/40 hover:bg-muted/50 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <ResearchChatMessage
            key={m.id}
            message={m}
            optionsEnabled={awaitingReply && !sending && m.id === lastMessage?.id}
            onOptionClick={(o) => void handleSend(o, [])}
          />
        ))}

        {isActive && (
          <div className="flex items-center gap-2.5 mb-4" aria-live="polite">
            <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center">
              <ReLexLogo size={16} showText={false} />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              {job?.progress_label_he ? `${job.progress_label_he}...` : "חושב..."}
            </div>
          </div>
        )}

        {notice && !isActive && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">
            {notice}
          </div>
        )}
      </div>

      <div className="pt-2 pb-3">
        <ConversationComposer
          ref={composerRef}
          disabled={isActive}
          sending={sending}
          allowFiles={!awaitingReply}
          placeholder={
            isActive ? "ReLex עובד על זה..." : awaitingReply ? "כתבו תשובה..." : messages.length ? "כתבו הודעה..." : "שאלו את ReLex..."
          }
          onSend={handleSend}
        />
        {isActive && (
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            העבודה ממשיכה ברקע — אפשר לסגור את הדף ולחזור לשיחה מאוחר יותר.
          </p>
        )}
      </div>

      <InsufficientCreditsDialog
        open={insufficient.open}
        onOpenChange={(open) => setInsufficient((p) => ({ ...p, open }))}
        required={insufficient.required}
        remaining={insufficient.remaining}
      />
    </div>
  );
}
