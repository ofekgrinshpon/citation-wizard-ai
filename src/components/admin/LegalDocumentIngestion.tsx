import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LegalDocumentIngestionProps {
  onIngested: () => void;
}

const SOURCE_TYPES = [
  { value: "legislation", label: "📜 חקיקה" },
  { value: "caselaw", label: "⚖️ פסיקה" },
  { value: "book", label: "📖 ספר" },
  { value: "article", label: "📄 מאמר" },
  { value: "international", label: "🌍 בינלאומי" },
];

export default function LegalDocumentIngestion({ onIngested }: LegalDocumentIngestionProps) {
  const [sourceType, setSourceType] = useState("legislation");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [citation, setCitation] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [stats, setStats] = useState<{ total: number; success: number; failed: number } | null>(null);

  const handleSingleIngest = async () => {
    if (!title || !content || !citation) {
      toast.error("נא למלא כותרת, תוכן ואזכור");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("embed-legal-source", {
        body: {
          source_type: sourceType,
          title,
          content,
          citation,
          source_url: sourceUrl || undefined,
          metadata: year ? { year } : {},
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`מקור "${title}" נוסף בהצלחה! (${data.chunks_count} חלקים)`);
      setTitle("");
      setContent("");
      setCitation("");
      setSourceUrl("");
      setYear("");
      onIngested();
    } catch (e: any) {
      console.error("Ingestion error:", e);
      toast.error(`שגיאה: ${e.message || "לא ניתן להוסיף מקור"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkIngest = async () => {
    if (!csvText.trim()) {
      toast.error("נא להזין נתוני CSV");
      return;
    }

    const lines = csvText.trim().split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("CSV חייב לכלול שורת כותרת ולפחות שורת נתונים אחת");
      return;
    }

    setLoading(true);
    let success = 0;
    let failed = 0;

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length < 4) {
        failed++;
        continue;
      }

      const [type, name, citationText, text, url] = parts;
      try {
        const { data, error } = await supabase.functions.invoke("embed-legal-source", {
          body: {
            source_type: type?.trim() || "legislation",
            title: name?.trim(),
            content: text?.trim(),
            citation: citationText?.trim(),
            source_url: url?.trim() || undefined,
          },
        });

        if (error || data?.error) {
          failed++;
        } else {
          success++;
        }
      } catch {
        failed++;
      }

      // Delay between requests
      await new Promise((r) => setTimeout(r, 500));
    }

    setStats({ total: lines.length - 1, success, failed });
    setLoading(false);
    if (success > 0) onIngested();
    toast.success(`יובאו ${success} מקורות, ${failed} נכשלו`);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button
          variant={bulkMode ? "outline" : "default"}
          size="sm"
          onClick={() => setBulkMode(false)}
        >
          הוספה בודדת
        </Button>
        <Button
          variant={bulkMode ? "default" : "outline"}
          size="sm"
          onClick={() => setBulkMode(true)}
        >
          ייבוא CSV
        </Button>
      </div>

      {!bulkMode ? (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📥 הוספת מקור משפטי למאגר</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>סוג מקור</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>שנה</Label>
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="לדוגמה: 1973"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>כותרת (שם החוק / פסק הדין / הספר)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='לדוגמה: חוק החוזים (חלק כללי), התשל"ג–1973'
              dir="rtl"
            />
          </div>

          <div className="space-y-2">
            <Label>אזכור מלא (לפי כללי האזכור האחיד)</Label>
            <Input
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              placeholder='לדוגמה: חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118'
              dir="rtl"
            />
          </div>

          <div className="space-y-2">
            <Label>קישור למקור (אופציונלי)</Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.nevo.co.il/..."
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label>תוכן (טקסט מלא או קטעים רלוונטיים)</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="הדביקו כאן את טקסט החוק, פסק הדין, או הספר..."
              className="min-h-[200px]"
              dir="rtl"
            />
          </div>

          <Button onClick={handleSingleIngest} disabled={loading} className="w-full">
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                מעבד ויוצר embeddings...
              </div>
            ) : (
              "📥 הוסף למאגר"
            )}
          </Button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📋 ייבוא מרובה (CSV)</h3>
          <p className="text-muted-foreground text-xs">
            הדביקו טבלה מופרדת ב-Tab. עמודות: סוג | כותרת | אזכור | תוכן | קישור (אופציונלי)
          </p>
          <div className="text-xs bg-muted p-3 rounded-lg font-mono" dir="ltr">
            type	title	citation	content	url<br />
            legislation	חוק החוזים	חוק החוזים...	טקסט החוק...	https://...
          </div>
          <Textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="הדביקו כאן את הנתונים..."
            className="min-h-[200px] font-mono text-xs"
            dir="ltr"
          />

          {stats && (
            <div className="flex gap-4 text-sm">
              <span>סה״כ: {stats.total}</span>
              <span className="text-primary">✓ הצליחו: {stats.success}</span>
              {stats.failed > 0 && <span className="text-destructive">✗ נכשלו: {stats.failed}</span>}
            </div>
          )}

          <Button onClick={handleBulkIngest} disabled={loading} className="w-full">
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                מייבא...
              </div>
            ) : (
              "📋 ייבא מקורות"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
