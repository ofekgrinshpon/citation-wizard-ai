import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, X } from "lucide-react";

interface LegalDocumentIngestionProps {
  onIngested: () => void;
}

const SOURCE_TYPES = [
  { value: "legislation", label: "📜 חקיקה" },
  { value: "caselaw", label: "⚖️ פסיקה" },
  { value: "book", label: "📖 ספר" },
  { value: "article", label: "📄 מאמר" },
  { value: "international", label: "🌍 בינלאומי" },
  { value: "notebook", label: "📓 מחברת לימודים" },
];

type Mode = "single" | "csv" | "file";

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item: any) => item.str).join(" "));
  }
  return pages.join("\n\n");
}

async function extractTextFromDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LegalDocumentIngestion({ onIngested }: LegalDocumentIngestionProps) {
  const [sourceType, setSourceType] = useState("legislation");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [citation, setCitation] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [csvText, setCsvText] = useState("");
  const [stats, setStats] = useState<{ total: number; success: number; failed: number } | null>(null);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isNotebook = sourceType === "notebook";

  const handleSingleIngest = async () => {
    if (!title || !content || (!citation && !isNotebook)) {
      toast.error(isNotebook ? "נא למלא כותרת ותוכן" : "נא למלא כותרת, תוכן ואזכור");
      return;
    }

    const finalCitation = citation || (isNotebook ? `מחברת לימודים: ${title}` : "");

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("embed-legal-source", {
        body: {
          source_type: sourceType,
          title,
          content,
          citation: finalCitation,
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

      await new Promise((r) => setTimeout(r, 500));
    }

    setStats({ total: lines.length - 1, success, failed });
    setLoading(false);
    if (success > 0) onIngested();
    toast.success(`יובאו ${success} מקורות, ${failed} נכשלו`);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setExtracting(true);

    const nameWithoutExt = file.name.replace(/\.[^.]+$/, "");
    setTitle(nameWithoutExt);

    try {
      let text = "";
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "txt") {
        text = await file.text();
      } else if (ext === "csv" || ext === "tsv") {
        // Switch to CSV mode with file content
        text = await file.text();
        setCsvText(text);
        setMode("csv");
        setExtracting(false);
        setSelectedFile(null);
        toast.success(`קובץ ${file.name} נטען למצב ייבוא CSV`);
        return;
      } else if (ext === "pdf") {
        text = await extractTextFromPdf(file);
      } else if (ext === "docx") {
        text = await extractTextFromDocx(file);
      } else {
        toast.error("סוג קובץ לא נתמך. נתמכים: txt, csv, tsv, pdf, docx");
        setSelectedFile(null);
        setExtracting(false);
        return;
      }

      setContent(text);
      toast.success(`טקסט חולץ בהצלחה (${text.length.toLocaleString()} תווים)`);
    } catch (err: any) {
      console.error("File extraction error:", err);
      toast.error(`שגיאה בחילוץ טקסט: ${err.message}`);
      setSelectedFile(null);
    } finally {
      setExtracting(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setContent("");
    setTitle("");
    setCitation("");
    setYear("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap">
        {(["single", "csv", "file"] as Mode[]).map((m) => (
          <Button
            key={m}
            variant={mode === m ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(m)}
          >
            {m === "single" ? "הוספה בודדת" : m === "csv" ? "ייבוא CSV" : "📤 העלאת קובץ"}
          </Button>
        ))}
      </div>

      {mode === "single" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📥 הוספת מקור משפטי למאגר</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>סוג מקור</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isNotebook && (
                <p className="text-xs text-muted-foreground mt-1">
                  📓 מחברות לימודים משמשות כרקע בלבד — ה-AI ישתמש בתוכן כדי להבין טוב יותר אך יצטט רק מקורות ראשוניים
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>שנה</Label>
              <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="לדוגמה: 1973" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>כותרת (שם החוק / פסק הדין / הספר)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder='לדוגמה: חוק החוזים (חלק כללי), התשל"ג–1973' dir="rtl" />
          </div>

          <div className="space-y-2">
            <Label>אזכור מלא {isNotebook ? "(אופציונלי)" : "(לפי כללי האזכור האחיד)"}</Label>
            <Input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder={isNotebook ? "ייווצר אוטומטית אם ריק" : 'לדוגמה: חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118'} dir="rtl" />
          </div>

          <div className="space-y-2">
            <Label>קישור למקור (אופציונלי)</Label>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://www.nevo.co.il/..." dir="ltr" />
          </div>

          <div className="space-y-2">
            <Label>תוכן (טקסט מלא או קטעים רלוונטיים)</Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="הדביקו כאן את טקסט החוק, פסק הדין, או הספר..." className="min-h-[200px]" dir="rtl" />
          </div>

          <Button onClick={handleSingleIngest} disabled={loading} className="w-full">
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                מעבד ויוצר embeddings...
              </div>
            ) : "📥 הוסף למאגר"}
          </Button>
        </div>
      )}

      {mode === "csv" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📋 ייבוא מרובה (CSV)</h3>
          <p className="text-muted-foreground text-xs">
            הדביקו טבלה מופרדת ב-Tab. עמודות: סוג | כותרת | אזכור | תוכן | קישור (אופציונלי)
          </p>
          <div className="text-xs bg-muted p-3 rounded-lg font-mono" dir="ltr">
            type	title	citation	content	url<br />
            legislation	חוק החוזים	חוק החוזים...	טקסט החוק...	https://...
          </div>
          <Textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="הדביקו כאן את הנתונים..." className="min-h-[200px] font-mono text-xs" dir="ltr" />

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
            ) : "📋 ייבא מקורות"}
          </Button>
        </div>
      )}

      {mode === "file" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📤 העלאת קובץ</h3>
          <p className="text-muted-foreground text-xs">
            העלו קובץ TXT, PDF, DOCX, CSV או TSV. הטקסט יחולץ אוטומטית.
          </p>

          {/* File picker */}
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.tsv,.pdf,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            {!selectedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
              >
                <Upload className="w-8 h-8" />
                <span className="text-sm font-medium">לחצו לבחירת קובץ</span>
                <span className="text-xs">.txt, .pdf, .docx, .csv, .tsv</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-muted rounded-lg p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={clearFile}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {extracting && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">מחלץ טקסט...</p>
              <Progress value={undefined} className="h-2" />
            </div>
          )}

          {selectedFile && !extracting && content && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>סוג מקור</Label>
                  <Select value={sourceType} onValueChange={setSourceType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isNotebook && (
                    <p className="text-xs text-muted-foreground mt-1">
                      📓 מחברות לימודים משמשות כרקע בלבד
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>שנה</Label>
                  <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="לדוגמה: 1973" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>כותרת</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} dir="rtl" />
              </div>

              <div className="space-y-2">
                <Label>אזכור מלא {isNotebook ? "(אופציונלי)" : ""}</Label>
                <Input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder={isNotebook ? "ייווצר אוטומטית אם ריק" : "נא להזין אזכור לפי כללי האזכור האחיד"} dir="rtl" />
              </div>

              <div className="space-y-2">
                <Label>קישור למקור (אופציונלי)</Label>
                <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." dir="ltr" />
              </div>

              <div className="space-y-2">
                <Label>תוכן שחולץ ({content.length.toLocaleString()} תווים)</Label>
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[200px] text-xs" dir="rtl" />
              </div>

              <Button onClick={handleSingleIngest} disabled={loading} className="w-full">
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    מעבד ויוצר embeddings...
                  </div>
                ) : "📤 העלה ועבד"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
