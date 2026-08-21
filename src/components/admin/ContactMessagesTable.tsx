import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, RefreshCw, Check, Undo2 } from "lucide-react";

interface ContactMessage {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  message: string;
  status: string;
  created_at: string;
  handled_at: string | null;
}

type Filter = "all" | "new" | "handled";

export function ContactMessagesTable() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("contact_messages")
      .select("id, first_name, last_name, email, message, status, created_at, handled_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: "שגיאה בטעינת הפניות", description: error.message, variant: "destructive" });
    } else {
      setMessages((data ?? []) as ContactMessage[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const setStatus = async (id: string, status: "new" | "handled") => {
    setUpdatingId(id);
    const { error } = await supabase
      .from("contact_messages")
      .update({ status, handled_at: status === "handled" ? new Date().toISOString() : null })
      .eq("id", id);
    setUpdatingId(null);
    if (error) {
      toast({ title: "עדכון הסטטוס נכשל", description: error.message, variant: "destructive" });
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, status, handled_at: status === "handled" ? new Date().toISOString() : null }
          : m,
      ),
    );
  };

  const visible = messages.filter((m) => (filter === "all" ? true : m.status === filter));
  const newCount = messages.filter((m) => m.status === "new").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {([
            { id: "all", label: `הכל (${messages.length})` },
            { id: "new", label: `חדשות (${newCount})` },
            { id: "handled", label: `טופלו (${messages.length - newCount})` },
          ] as { id: Filter; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void fetchMessages()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          רענון
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">אין פניות להצגה.</div>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">
                      {m.first_name} {m.last_name}
                    </span>
                    <Badge variant={m.status === "handled" ? "secondary" : "default"}>
                      {m.status === "handled" ? "טופל" : "חדש"}
                    </Badge>
                  </div>
                  <a
                    href={`mailto:${m.email}`}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    dir="ltr"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {m.email}
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleString("he-IL")}
                  </span>
                  <button
                    onClick={() => void setStatus(m.id, m.status === "handled" ? "new" : "handled")}
                    disabled={updatingId === m.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-xs hover:bg-muted disabled:opacity-60"
                  >
                    {updatingId === m.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : m.status === "handled" ? (
                      <Undo2 className="w-3.5 h-3.5" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    {m.status === "handled" ? "החזרה לחדש" : "סימון כטופל"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap border-t border-border/60 pt-2">
                {m.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
