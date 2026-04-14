import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

interface BatchResult {
  processed: number;
  failed: number;
  remaining: number | null;
  batch_size: number;
  error?: string;
}

export default function BatchEmbeddingPanel() {
  const [running, setRunning] = useState(false);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [batchCount, setBatchCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);
  const abortRef = useRef(false);

  const totalChunks = remaining !== null ? totalProcessed + remaining : null;
  const progress = totalChunks && totalChunks > 0 ? (totalProcessed / totalChunks) * 100 : 0;

  const runBatch = useCallback(async () => {
    abortRef.current = false;
    setRunning(true);
    setTotalProcessed(0);
    setTotalFailed(0);
    setBatchCount(0);
    setLastError(null);
    setRemaining(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("לא מחובר — יש להתחבר מחדש");
      setRunning(false);
      return;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-embed-chunks`;
    let consecutiveErrors = 0;

    while (!abortRef.current) {
      try {
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (!freshSession) {
          toast.error("הסשן פג תוקף — יש להתחבר מחדש");
          break;
        }

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${freshSession.access_token}`,
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("Batch error:", res.status, errText);
          setLastError(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            toast.error("3 שגיאות רצופות — התהליך נעצר");
            break;
          }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        consecutiveErrors = 0;
        const data: BatchResult = await res.json();

        if (data.error) {
          setLastError(data.error);
          toast.error(`שגיאת שרת: ${data.error}`);
          break;
        }

        setTotalProcessed((prev) => prev + data.processed);
        setTotalFailed((prev) => prev + data.failed);
        setRemaining(data.remaining);
        setBatchCount((prev) => prev + 1);

        if (data.remaining === 0) {
          toast.success("כל ה-chunks עובדו בהצלחה! 🎉 עכשיו אפשר לבנות מחדש את אינדקס החיפוש.");
          break;
        }

        if (data.processed === 0 && data.failed > 0) {
          setLastError(`כל ${data.failed} ה-chunks באצווה נכשלו`);
          toast.error("כל ה-chunks באצווה נכשלו — יש לבדוק את הלוגים");
          break;
        }

        if (data.processed === 0 && data.failed === 0 && data.batch_size === 0 && (data.remaining ?? 0) > 0) {
          setLastError("אצווה ריקה למרות שנותרו chunks — ייתכן בעיית שליפה");
          toast.error("בעיה בשליפת chunks — התהליך נעצר");
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error("Batch fetch error:", err);
        setLastError(err instanceof Error ? err.message : "שגיאת רשת");
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          toast.error("שגיאת רשת — התהליך נעצר");
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (abortRef.current) {
      toast.info("התהליך נעצר ידנית");
    }

    setRunning(false);
  }, []);

  const stop = () => {
    abortRef.current = true;
  };

  const rebuildIndex = useCallback(async () => {
    setRebuildingIndex(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("לא מחובר");
        return;
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rebuild-hnsw-index`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        toast.error(`שגיאה בבניית אינדקס: ${errText.slice(0, 200)}`);
        return;
      }

      const data = await res.json();
      if (data.error) {
        toast.error(`שגיאה: ${data.error}`);
      } else {
        toast.success("אינדקס HNSW נבנה מחדש בהצלחה! 🎉");
      }
    } catch (err) {
      toast.error("שגיאת רשת בבניית אינדקס");
    } finally {
      setRebuildingIndex(false);
    }
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-foreground font-bold text-sm">🧬 יצירת Embeddings (Vector Search)</h3>
        <div className="flex gap-2">
          {running ? (
            <Button variant="destructive" size="sm" onClick={stop}>
              ⏹ עצור
            </Button>
          ) : (
            <Button size="sm" onClick={runBatch}>
              ▶️ הפעל Batch Embedding
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={rebuildIndex}
            disabled={running || rebuildingIndex}
          >
            {rebuildingIndex ? "⏳ בונה אינדקס..." : "🔧 בנה אינדקס HNSW"}
          </Button>
        </div>
      </div>

      {(running || totalProcessed > 0 || totalFailed > 0) && (
        <>
          <Progress value={progress} className="h-3" />
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>✅ עובדו: <strong className="text-foreground">{totalProcessed.toLocaleString()}</strong></span>
            {totalFailed > 0 && (
              <span>❌ נכשלו: <strong className="text-destructive">{totalFailed.toLocaleString()}</strong></span>
            )}
            {remaining !== null && (
              <span>⏳ נותרו: <strong className="text-foreground">{remaining.toLocaleString()}</strong></span>
            )}
            <span>🔄 אצוות: <strong className="text-foreground">{batchCount}</strong></span>
            {totalChunks !== null && totalChunks > 0 && (
              <span>📊 התקדמות: <strong className="text-foreground">{progress.toFixed(1)}%</strong></span>
            )}
          </div>
        </>
      )}

      {lastError && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2 break-all">
          ⚠️ {lastError}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        כל הפעלה מעבדת עד 500 קטעים (200×2 במקביל). התהליך רץ בלופ אוטומטי עד שכל הקטעים מקבלים embedding.
        לאחר סיום כל ה-embeddings, לחצו "בנה אינדקס HNSW" לשחזור חיפוש וקטורי מהיר.
      </p>
    </div>
  );
}
