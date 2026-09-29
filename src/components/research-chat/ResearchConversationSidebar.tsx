import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Search, MoreHorizontal, Pencil, Archive, History, ChevronRight } from "lucide-react";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { he } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CONVERSATIONS_CHANGED,
  archiveConversation,
  listConversations,
  renameConversation,
  trackConversationEvent,
  type ConversationRow,
} from "@/lib/researchConversation";

function groupLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "היום";
  if (isYesterday(d)) return "אתמול";
  return "קודם";
}

export function ResearchConversationSidebar({
  projectId,
  legacyHistory,
  onNavigate,
}: {
  projectId: string | null;
  /** Legacy research history (pre-conversation jobs), shown on demand. */
  legacyHistory?: ReactNode;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [query, setQuery] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listConversations(projectId));
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => void refresh();
    window.addEventListener(CONVERSATIONS_CHANGED, h);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, h);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? items.filter((c) => (c.title ?? "").includes(q)) : items;
  }, [items, query]);

  const groups = useMemo(() => {
    const out: { label: string; items: ConversationRow[] }[] = [];
    for (const c of filtered) {
      const label = groupLabel(c.last_message_at);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [filtered]);

  const newChat = () => {
    trackConversationEvent("new_chat_clicked", { project_id: projectId });
    navigate("/app");
    onNavigate?.();
  };

  if (showLegacy && legacyHistory) {
    return (
      <div className="flex flex-col h-full w-72 border-r border-border bg-card" dir="rtl">
        <button
          onClick={() => setShowLegacy(false)}
          className="flex items-center gap-1 px-3 py-2.5 text-sm font-medium text-foreground border-b border-border hover:bg-muted/50"
        >
          <ChevronRight className="w-4 h-4" />
          חזרה לשיחות
        </button>
        <div className="flex-1 min-h-0 flex">{legacyHistory}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-72 border-r border-border bg-card" dir="rtl">
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">שיחות</h3>
        </div>
        <Button onClick={newChat} className="w-full gap-1.5" size="sm">
          <Plus className="w-4 h-4" />
          צ'אט חדש
        </Button>
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש בשיחות..."
            className="h-8 pr-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
        <div className="p-2 space-y-3 w-full min-w-0 overflow-hidden">
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {query ? "לא נמצאו שיחות" : "עדיין אין שיחות"}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{g.label}</div>
              {g.items.map((c) => {
                const active = c.id === conversationId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${active ? "bg-muted" : "hover:bg-muted/50"}`}
                  >
                    <button
                      className="flex-1 min-w-0 text-right"
                      onClick={() => { navigate(`/app/chat/${c.id}`); onNavigate?.(); }}
                    >
                      <div className="text-sm text-foreground truncate">{c.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true, locale: he })}
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label="אפשרויות שיחה"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground hover:text-foreground"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={async () => {
                            const t = window.prompt("שם חדש לשיחה", c.title ?? "");
                            if (t && t.trim()) await renameConversation(c.id, t);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5 ml-2" />
                          שינוי שם
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            await archiveConversation(c.id);
                            if (active) navigate("/app");
                          }}
                        >
                          <Archive className="w-3.5 h-3.5 ml-2" />
                          העברה לארכיון
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>

      {legacyHistory && (
        <button
          onClick={() => setShowLegacy(true)}
          className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-muted-foreground border-t border-border hover:text-foreground hover:bg-muted/50"
        >
          <History className="w-3.5 h-3.5" />
          מחקרים קודמים
        </button>
      )}
    </div>
  );
}
