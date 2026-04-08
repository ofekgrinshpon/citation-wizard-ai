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
import { Upload, FileText, X, Check, AlertCircle, Loader2 } from "lucide-react";

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

type FileStatus = "pending" | "extracting" | "ready" | "uploading" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  title: string;
  content: string;
  citation: string;
  year: string;
  sourceType: string;
  sourceUrl: string;
  status: FileStatus;
  error?: string;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs`;
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

async function extractTextFromDoc(file: File): Promise<string> {
  const WordExtractor = (await import("word-extractor")).default;
  const extractor = new WordExtractor();
  const arrayBuffer = await file.arrayBuffer();
  const doc = await extractor.extract(arrayBuffer);
  return doc.getBody();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return file.text();
  if (ext === "pdf") return extractTextFromPdf(file);
  if (ext === "docx") return extractTextFromDocx(file);
  if (ext === "doc") return extractTextFromDoc(file);
  throw new Error(`סוג קובץ לא נתמך: .${ext}`);
}

const STATUS_ICON: Record<FileStatus, React.ReactNode> = {
  pending: <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />,
  extracting: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
  ready: <FileText className="w-4 h-4 text-primary" />,
  uploading: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
  done: <Check className="w-4 h-4 text-primary" />,
  error: <AlertCircle className="w-4 h-4 text-destructive" />,
};

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

  // Multi-file state
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isNotebook = sourceType === "notebook";

  const updateQueueItem = (id: string, updates: Partial<QueuedFile>) => {
    setFileQueue(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

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
          source_type: sourceType, title, content, citation: finalCitation,
          source_url: sourceUrl || undefined, metadata: year ? { year } : {},
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`מקור "${title}" נוסף בהצלחה! (${data.chunks_count} חלקים)`);
      setTitle(""); setContent(""); setCitation(""); setSourceUrl(""); setYear("");
      onIngested();
    } catch (e: any) {
      toast.error(`שגיאה: ${e.message || "לא ניתן להוסיף מקור"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkIngest = async () => {
    if (!csvText.trim()) { toast.error("נא להזין נתוני CSV"); return; }
    const lines = csvText.trim().split("\n").filter((l) => l.trim());
    if (lines.length < 2) { toast.error("CSV חייב לכלול שורת כותרת ולפחות שורת נתונים אחת"); return; }
    setLoading(true);
    let success = 0, failed = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length < 4) { failed++; continue; }
      const [type, name, citationText, text, url] = parts;
      try {
        const { data, error } = await supabase.functions.invoke("embed-legal-source", {
          body: { source_type: type?.trim() || "legislation", title: name?.trim(), content: text?.trim(), citation: citationText?.trim(), source_url: url?.trim() || undefined },
        });
        if (error || data?.error) failed++; else success++;
      } catch { failed++; }
      await new Promise((r) => setTimeout(r, 500));
    }
    setStats({ total: lines.length - 1, success, failed });
    setLoading(false);
    if (success > 0) onIngested();
    toast.success(`יובאו ${success} מקורות, ${failed} נכשלו`);
  };

  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Filter out CSV/TSV → switch to CSV mode
    const csvFiles = files.filter(f => /\.(csv|tsv)$/i.test(f.name));
    const docFiles = files.filter(f => !/\.(csv|tsv)$/i.test(f.name));

    if (csvFiles.length > 0 && docFiles.length === 0) {
      const text = await csvFiles[0].text();
      setCsvText(text);
      setMode("csv");
      toast.success(`קובץ ${csvFiles[0].name} נטען למצב ייבוא CSV`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const newItems: QueuedFile[] = docFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      title: file.name.replace(/\.[^.]+$/, ""),
      content: "",
      citation: "",
      year: "",
      sourceType: "legislation",
      sourceUrl: "",
      status: "pending" as FileStatus,
    }));

    setFileQueue(prev => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Extract text from all new files
    for (const item of newItems) {
      updateQueueItem(item.id, { status: "extracting" });
      try {
        const text = await extractText(item.file);
        // Use functional update to avoid stale state
        setFileQueue(prev => prev.map(f => f.id === item.id ? { ...f, content: text, status: "ready" } : f));
      } catch (err: any) {
        setFileQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: "error", error: err.message } : f));
      }
    }
  };

  const removeFromQueue = (id: string) => {
    setFileQueue(prev => prev.filter(f => f.id !== id));
  };

  const handleUploadAll = async () => {
    const ready = fileQueue.filter(f => f.status === "ready");
    if (!ready.length) { toast.error("אין קבצים מוכנים להעלאה"); return; }

    setUploading(true);
    let success = 0, failed = 0;
    const CONCURRENCY = 3;
    let nextIndex = 0;

    const processNext = async (): Promise<void> => {
      if (nextIndex >= ready.length) return;
      const item = ready[nextIndex++];

      updateQueueItem(item.id, { status: "uploading" });
      const isNb = item.sourceType === "notebook";
      const finalCitation = item.citation || (isNb ? `מחברת לימודים: ${item.title}` : "");

      if (!item.title || !item.content || (!finalCitation && !isNb)) {
        updateQueueItem(item.id, { status: "error", error: "חסרים שדות חובה" });
        failed++;
        await processNext();
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("embed-legal-source", {
          body: {
            source_type: item.sourceType, title: item.title, content: item.content,
            citation: finalCitation, source_url: item.sourceUrl || undefined,
            metadata: item.year ? { year: item.year } : {},
          },
        });
        if (error || data?.error) throw new Error(data?.error || error.message);
        updateQueueItem(item.id, { status: "done" });
        success++;
      } catch (err: any) {
        updateQueueItem(item.id, { status: "error", error: err.message });
        failed++;
      }
      await processNext();
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, ready.length) }, () => processNext());
    await Promise.all(workers);

    setUploading(false);
    if (success > 0) onIngested();
    toast.success(`הועלו ${success} מקורות${failed > 0 ? `, ${failed} נכשלו` : ""}`);
  };

  const readyCount = fileQueue.filter(f => f.status === "ready").length;
  const doneCount = fileQueue.filter(f => f.status === "done").length;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap">
        {(["single", "csv", "file"] as Mode[]).map((m) => (
          <Button key={m} variant={mode === m ? "default" : "outline"} size="sm" onClick={() => setMode(m)}>
            {m === "single" ? "הוספה בודדת" : m === "csv" ? "ייבוא CSV" : "📤 העלאת קבצים"}
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
                  {SOURCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {isNotebook && <p className="text-xs text-muted-foreground mt-1">📓 מחברות לימודים משמשות כרקע בלבד — ה-AI ישתמש בתוכן כדי להבין טוב יותר אך יצטט רק מקורות ראשוניים</p>}
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
            {loading ? <div className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />מעבד ויוצר embeddings...</div> : "📥 הוסף למאגר"}
          </Button>
        </div>
      )}

      {mode === "csv" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📋 ייבוא מרובה (CSV)</h3>
          <p className="text-muted-foreground text-xs">הדביקו טבלה מופרדת ב-Tab. עמודות: סוג | כותרת | אזכור | תוכן | קישור (אופציונלי)</p>
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
            {loading ? <div className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />מייבא...</div> : "📋 ייבא מקורות"}
          </Button>
        </div>
      )}

      {mode === "file" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-foreground font-bold text-sm">📤 העלאת קבצים</h3>
          <p className="text-muted-foreground text-xs">העלו קבצי TXT, PDF או DOCX. ניתן לבחור מספר קבצים בו-זמנית.</p>

          <input ref={fileInputRef} type="file" accept=".txt,.pdf,.doc,.docx,.csv,.tsv" multiple onChange={handleFilesSelect} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
          >
            <Upload className="w-8 h-8" />
            <span className="text-sm font-medium">לחצו לבחירת קבצים</span>
            <span className="text-xs">.txt, .pdf, .doc, .docx (ניתן לבחור מספר קבצים)</span>
          </button>

          {fileQueue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{fileQueue.length} קבצים בתור</span>
                {doneCount > 0 && <span className="text-xs text-primary">{doneCount} הושלמו</span>}
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {fileQueue.map((item) => (
                  <div key={item.id} className="border border-border rounded-lg p-3 space-y-2 bg-background">
                    <div className="flex items-center gap-2">
                      {STATUS_ICON[item.status]}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(item.file.size)}
                          {item.content && ` · ${item.content.length.toLocaleString()} תווים`}
                        </p>
                      </div>
                      {item.status !== "uploading" && item.status !== "done" && (
                        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={() => removeFromQueue(item.id)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>

                    {item.status === "error" && (
                      <p className="text-xs text-destructive">{item.error}</p>
                    )}

                    {item.status === "ready" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={item.sourceType} onValueChange={(v) => updateQueueItem(item.id, { sourceType: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SOURCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input className="h-8 text-xs" value={item.year} onChange={(e) => updateQueueItem(item.id, { year: e.target.value })} placeholder="שנה" />
                        <Input className="h-8 text-xs col-span-2" value={item.title} onChange={(e) => updateQueueItem(item.id, { title: e.target.value })} placeholder="כותרת" dir="rtl" />
                        <Input className="h-8 text-xs col-span-2" value={item.citation} onChange={(e) => updateQueueItem(item.id, { citation: e.target.value })} placeholder={item.sourceType === "notebook" ? "אופציונלי" : "אזכור מלא"} dir="rtl" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {readyCount > 0 && (
                <Button onClick={handleUploadAll} disabled={uploading} className="w-full">
                  {uploading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      מעלה...
                    </div>
                  ) : `📤 העלה ${readyCount} קבצים`}
                </Button>
              )}

              {fileQueue.length > 0 && !uploading && (
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setFileQueue([])}>
                  נקה תור
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
