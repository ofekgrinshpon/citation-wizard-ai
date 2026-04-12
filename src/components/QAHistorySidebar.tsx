import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, BookOpen, FileSearch, PenTool, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";

interface QALogRecord {
  id: string;
  question: string;
  answer: string | null;
  footnotes: any[] | null;
  task_mode: string | null;
  created_at: string;
}

interface QAResult {
  answer: string;
  footnotes: { number: number; citation: string; source_type: string; url?: string; source?: "local" | "perplexity" | "document" }[];
  source_urls: string[];
}

interface Props {
  projectId: string | null;
  onLoadResult?: (question: string, result: QAResult, taskMode: string) => void;
}

const MODE_LABELS: Record<string, { label: string; icon: typeof Search }> = {
  research: { label: "מחקר", icon: Search },
  pleading_analysis: { label: "ניתוח טענה", icon: FileSearch },
  case_summary: { label: "סיכום", icon: BookOpen },
  argument_draft: { label: "ניסוח", icon: PenTool },
};

export function QAHistorySidebar({ projectId, onLoadResult }: Props) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<QALogRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setLogs([]);
      return;
    }

    const fetchLogs = async () => {
      setLoading(true);
      let query = supabase
        .from("qa_logs")
        .select("id, question, answer, footnotes, task_mode, created_at")
        .eq("user_id", user.id)
        .not("answer", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);

      if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error } = await query;
      if (error) {
        console.error("Failed to fetch QA logs:", error);
      } else {
        setLogs((data as QALogRecord[]) || []);
      }
      setLoading(false);
    };

    fetchLogs();
  }, [user, projectId]);

  const filtered = search.trim()
    ? logs.filter((l) => l.question.toLowerCase().includes(search.toLowerCase()))
    : logs;

  const handleClick = (log: QALogRecord) => {
    if (!onLoadResult || !log.answer) return;
    const result: QAResult = {
      answer: log.answer,
      footnotes: Array.isArray(log.footnotes) ? log.footnotes as any : [],
      source_urls: [],
    };
    onLoadResult(log.question, result, log.task_mode || "research");
  };

  return (
    <div
      className="w-72 border-r border-border bg-card flex flex-col h-full"
      style={{ direction: "rtl" }}
    >
      <div className="px-3 pt-4 pb-2 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground mb-2">היסטוריית מחקר</h3>
        <div className="relative">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            className="pr-8 h-8 text-xs"
            dir="rtl"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-4">טוען...</p>
          )}

          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? "לא נמצאו תוצאות" : "אין היסטוריה עדיין"}
            </p>
          )}

          {filtered.map((log) => {
            const mode = MODE_LABELS[log.task_mode || "research"] || MODE_LABELS.research;
            const Icon = mode.icon;
            const timeAgo = formatDistanceToNow(new Date(log.created_at), {
              addSuffix: true,
              locale: he,
            });

            return (
              <button
                key={log.id}
                onClick={() => handleClick(log)}
                className="w-full text-right rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground leading-relaxed line-clamp-2 group-hover:text-primary transition-colors">
                      {log.question}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        {mode.label}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
