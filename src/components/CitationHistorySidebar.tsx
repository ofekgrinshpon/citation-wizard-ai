import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface CitationRecord {
  id: string;
  raw_input: string;
  formatted_output: string;
  source_type: string | null;
  is_verified: boolean | null;
  created_at: string;
}

interface Props {
  projectId: string | null;
  refreshKey?: number;
}

const SOURCE_LABELS: Record<string, string> = {
  caselaw: "פסיקה",
  legislation_primary: "חקיקה ראשית",
  legislation_secondary: "חקיקה משנית",
  book: "ספר",
  article: "מאמר",
  treaty: "אמנה",
  bill: "הצעת חוק",
  regulations: "תקנות",
};

export function CitationHistorySidebar({ projectId, refreshKey }: Props) {
  const { user } = useAuth();
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !projectId) {
      setCitations([]);
      return;
    }

    const fetchCitations = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("citation_history")
        .select("id, raw_input, formatted_output, source_type, is_verified, created_at")
        .eq("user_id", user.id)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setCitations(data as CitationRecord[]);
      }
      setLoading(false);
    };

    void fetchCitations();
  }, [user, projectId, refreshKey]);

  const filtered = search.trim()
    ? citations.filter(
        (c) =>
          c.raw_input.includes(search) ||
          c.formatted_output.includes(search)
      )
    : citations;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("הועתק ללוח");
    } catch {
      toast.error("שגיאה בהעתקה");
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
  };

  return (
    <div
      className="w-64 border-l border-border bg-sidebar-background flex flex-col self-stretch"
      style={{ direction: "rtl" }}
    >
      <div className="px-3 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-sidebar-foreground mb-2">
          היסטוריית אזכורים
        </h3>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש..."
          className="h-8 text-xs bg-surface border-border"
        />
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            טוען...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {search ? "לא נמצאו תוצאות" : "אין אזכורים עדיין"}
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCopy(c.formatted_output)}
                className="w-full text-right p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors group cursor-pointer"
                title="לחץ להעתקה"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {c.source_type && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 font-normal"
                    >
                      {SOURCE_LABELS[c.source_type] || c.source_type}
                    </Badge>
                  )}
                  {c.is_verified && (
                    <span className="text-[10px] text-secondary">✓</span>
                  )}
                  <span className="text-[10px] text-muted-foreground mr-auto">
                    {formatTime(c.created_at)}
                  </span>
                </div>
                <p className="text-xs text-sidebar-foreground leading-relaxed line-clamp-2">
                  {c.formatted_output}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  📋 העתק
                </p>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
