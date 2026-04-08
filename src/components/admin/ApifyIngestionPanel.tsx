import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface FailedDoc {
  id: string;
  title: string;
  ingestion_error: string | null;
  created_at: string;
}

interface ApifyIngestionPanelProps {
  onIngested: () => void;
}

export default function ApifyIngestionPanel({ onIngested }: ApifyIngestionPanelProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [results, setResults] = useState<{ inserted: number; skipped: number; failed: Array<{ title: string; error: string }> } | null>(null);

  const fetchFailed = async () => {
    const { data } = await supabase
      .from("legal_documents")
      .select("id, title, ingestion_error, created_at")
      .eq("ingestion_status", "partial_failure")
      .order("created_at", { ascending: false });
    setFailedDocs((data as FailedDoc[] | null) ?? []);
  };

  useEffect(() => {
    fetchFailed();
  }, []);

  const handleIngest = async () => {
    let cases: unknown[];
    try {
      const parsed = JSON.parse(jsonInput);
      cases = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      toast.error("JSON לא תקין");
      return;
    }

    setIngesting(true);
    setResults(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apify-ingest-cases`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(cases),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Ingestion failed");
      }

      const data = await res.json();
      setResults(data);
      toast.success(`הועלו ${data.inserted} מסמכים, דולגו ${data.skipped}, נכשלו ${data.failed?.length || 0}`);
      setJsonInput("");
      fetchFailed();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בהעלאה");
    } finally {
      setIngesting(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry-failed-ingestion`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: "{}",
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Retry failed");
      }

      const data = await res.json();
      toast.success(`נוסו שוב ${data.retried}: ${data.succeeded} הצליחו, ${data.still_failed} עדיין נכשלו`);
      fetchFailed();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בניסיון חוזר");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
          🕷️ העלאת פסיקה מ-Apify
        </h3>
        <p className="text-muted-foreground text-xs">
          הדביקו את ה-JSON מה-Apify dataset. כל רשומה שכוללת "תקציר" בכותרת תדולג אוטומטית.
        </p>
        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder='[{"title": "...", "case_number": "...", "court": "...", "docx_url": "..."}]'
          className="w-full h-32 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-y"
          dir="ltr"
        />
        <Button onClick={handleIngest} disabled={ingesting || !jsonInput.trim()}>
          {ingesting ? "מעלה..." : "העלה פסיקה"}
        </Button>

        {results && (
          <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
            <p>✅ הועלו: <strong>{results.inserted}</strong></p>
            <p>⏭️ דולגו (תקציר): <strong>{results.skipped}</strong></p>
            <p>❌ נכשלו: <strong>{results.failed.length}</strong></p>
            {results.failed.length > 0 && (
              <ul className="mt-2 text-xs text-destructive space-y-1">
                {results.failed.map((f, i) => (
                  <li key={i}>• {f.title}: {f.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Failed ingestions */}
      {failedDocs.length > 0 && (
        <div className="bg-card border border-destructive/30 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
              ⚠️ מסמכים שנכשלו
              <Badge variant="destructive">{failedDocs.length}</Badge>
            </h3>
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? "מנסה שוב..." : "🔄 נסה שוב"}
            </Button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {failedDocs.map((doc) => (
              <div key={doc.id} className="flex items-start justify-between bg-muted/50 rounded p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{doc.title}</p>
                  <p className="text-destructive mt-0.5">{doc.ingestion_error || "שגיאה לא ידועה"}</p>
                </div>
                <span className="text-muted-foreground mr-2 whitespace-nowrap">
                  {new Date(doc.created_at).toLocaleDateString("he-IL")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
