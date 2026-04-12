import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { copyPlainText } from "@/lib/clipboard";
import { Send, Copy, AlertTriangle, ExternalLink, Upload, X, FileText, Search, FileSearch, BookOpen, PenTool, type LucideIcon } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Types ───────────────────────────────────────────────────────────

interface Footnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
  source?: "local" | "perplexity" | "document";
}

interface QAResult {
  answer: string;
  footnotes: Footnote[];
  source_urls: string[];
}

type TaskMode = "research" | "pleading_analysis" | "case_summary" | "argument_draft";

const FILE_RELEVANT_MODES: TaskMode[] = ["pleading_analysis", "case_summary"];

const TASK_MODES: { id: TaskMode; label: string; description: string; placeholder: string }[] = [
  { id: "research", label: "מחקר משפטי", description: "סריקה מקיפה עם מסגרת נורמטיבית מלאה", placeholder: "תארו שאלה משפטית לסקירה מקיפה..." },
  { id: "pleading_analysis", label: "ניתוח כתב טענה", description: "זיהוי חולשות, סתירות ואזכורים חסרים", placeholder: "הדביקו כתב טענה או העלו קובץ לניתוח..." },
  { id: "case_summary", label: "סיכום פסיקה", description: "תמצית: עובדות, שאלה משפטית, הכרעה ורציו", placeholder: "הזינו שם פסק דין או הדביקו טקסט לסיכום..." },
  { id: "argument_draft", label: "ניסוח טיעון", description: "כתיבה משכנעת המבוססת על מקורות מוסמכים", placeholder: "תארו את הטיעון שברצונכם לבנות..." },
];

const DAVID_FONT = "David, 'David Libre', serif";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DOC_TEXT = 30000;

// ─── Utility components ──────────────────────────────────────────────

function superscriptToNumber(s: string): number | null {
  const map: Record<string, string> = {
    "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
    "\u2074": "4", "\u2075": "5", "\u2076": "6",
    "\u2077": "7", "\u2078": "8", "\u2079": "9",
  };
  let num = "";
  for (const c of s) {
    if (map[c]) num += map[c];
    else return null;
  }
  return num ? parseInt(num, 10) : null;
}

function AnswerWithFootnotes({ text, onFootnoteClick }: { text: string; onFootnoteClick: (n: number) => void }) {
  const parts = text.split(/([\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+|\[\d{1,2}\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const bracketMatch = part.match(/^\[(\d{1,2})\]$/);
        const num = superscriptToNumber(part) ?? (bracketMatch ? parseInt(bracketMatch[1], 10) : null);
        if (num !== null) {
          return (
            <sup
              key={i}
              className="text-primary cursor-pointer hover:underline font-bold"
              style={{ fontSize: "10px", fontFamily: DAVID_FONT }}
              onClick={() => onFootnoteClick(num)}
            >
              {bracketMatch ? num : part}
            </sup>
          );
        }
        return <RenderBold key={i} text={part} />;
      })}
    </>
  );
}

function RenderBold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((segment, i) =>
        i % 2 === 1 ? <strong key={i}>{segment}</strong> : <span key={i}>{segment}</span>
      )}
    </>
  );
}

// ─── PDF text extraction ─────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages && text.length < MAX_DOC_TEXT; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  return text.slice(0, MAX_DOC_TEXT);
}

async function extractDocxText(file: File): Promise<string> {
  // Use mammoth on the client side
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.slice(0, MAX_DOC_TEXT);
}

// ─── Main Component ──────────────────────────────────────────────────

export function LegalQAChat() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskMode, setTaskMode] = useState<TaskMode>("research");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (result) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [result]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [question]);

  // Extract text when file is uploaded
  const handleFileSelect = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("הקובץ גדול מדי. מקסימום 20MB.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) {
      toast.error("יש להעלות קובץ PDF או DOCX בלבד.");
      return;
    }

    setUploadedFile(file);
    setExtracting(true);
    try {
      const text = ext === "pdf" ? await extractPdfText(file) : await extractDocxText(file);
      setExtractedText(text);
      toast.success(`הקובץ "${file.name}" נטען בהצלחה (${(text.length / 1000).toFixed(0)}K תווים)`);
    } catch (e) {
      console.error("File extraction error:", e);
      toast.error("שגיאה בחילוץ טקסט מהקובץ.");
      setUploadedFile(null);
      setExtractedText(null);
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const isFileRelevantMode = FILE_RELEVANT_MODES.includes(taskMode);

  const handleModeChange = useCallback((value: string) => {
    if (!value) return;
    const newMode = value as TaskMode;
    setTaskMode(newMode);
    if (uploadedFile && !FILE_RELEVANT_MODES.includes(newMode)) {
      toast.warning("שימו לב: הקובץ שהועלה עדיין מצורף. ניתן להסיר אותו אם אינו רלוונטי למצב הנוכחי.", {
        action: {
          label: "הסר קובץ",
          onClick: () => removeFile(),
        },
        duration: 6000,
      });
    }
  }, [uploadedFile]);

  const removeFile = () => {
    setUploadedFile(null);
    setExtractedText(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    const q = question.trim();
    if (!q || q.length < 5) {
      toast.error("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        question: q,
        taskMode,
      };
      if (extractedText) {
        body.documentText = extractedText;
        body.documentName = uploadedFile?.name;
      }

      const { data, error: fnError } = await supabase.functions.invoke("legal-qa", { body });

      if (fnError) {
        const statusCode = (fnError as any)?.status || (fnError as any)?.context?.status;
        if (statusCode === 429) {
          setError("יותר מדי בקשות. נסו שוב בעוד דקה.");
          return;
        }
        if (statusCode === 402) {
          setError("נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות.");
          return;
        }
        throw fnError;
      }
      if (data?.error) {
        setError(data.error);
        return;
      }

      if (!data?.answer || data.answer.trim().length < 20) {
        setError("העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב.");
        return;
      }

      setResult(data as QAResult);
    } catch (e: any) {
      console.error("Legal QA error:", e);
      setError("שגיאה בעיבוד השאלה. נסו שוב.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const footnotesText = result.footnotes
      .map((f) => `${f.number}. ${f.citation}`)
      .join("\n");
    const fullText = `${result.answer}\n\nהערות שוליים:\n${footnotesText}`;
    copyPlainText(fullText);
    toast.success("הועתק ללוח");
  };

  const scrollToFootnote = (num: number) => {
    const el = document.getElementById(`legalqa-footnote-${num}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getSourceBadge = (source?: string) => {
    if (source === "local") return { color: "hsl(var(--primary))", label: "מאגר מקומי" };
    if (source === "document") return { color: "hsl(var(--accent-foreground))", label: "מתוך הקובץ" };
    return { color: "hsl(var(--muted-foreground))", label: "חיפוש אינטרנט" };
  };

  const activeMode = TASK_MODES.find((m) => m.id === taskMode)!;

  return (
    <div className="flex flex-col h-full" style={{ direction: "rtl" }}>
      {/* Query Panel — top */}
      <div className="px-2 sm:px-4 pt-4 pb-2 space-y-3">
        {/* Disclaimer */}
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <AlertDescription className="text-destructive text-[10px]">
            תשובות ReLex הן בגדר עזר בלבד ואינן מהוות ייעוץ משפטי. יש לבדוק את המקורות באופן עצמאי.
          </AlertDescription>
        </Alert>

        {/* Task Mode Pills */}
        <div className="space-y-1.5">
          <ToggleGroup
            type="single"
            value={taskMode}
            onValueChange={handleModeChange}
            className="flex flex-wrap gap-1.5 justify-start"
          >
            {TASK_MODES.map((m) => (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                className="text-[11px] sm:text-xs px-3 py-2 rounded-full border border-border transition-all data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary data-[state=on]:shadow-sm"
              >
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-[10px] text-muted-foreground pr-1 transition-all duration-200">
            {activeMode.description}
          </p>
        </div>

        {/* Input area with file upload */}
        <div className="flex gap-2 items-end">
          {/* File upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !uploadedFile && fileInputRef.current?.click()}
            className={`flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
              uploadedFile
                ? isFileRelevantMode
                  ? "border-primary/40 bg-primary/5"
                  : "border-amber-400/60 bg-amber-50/30 dark:bg-amber-900/10"
                : "border-border hover:border-primary/30 hover:bg-muted/50"
            }`}
          >
            {extracting ? (
              <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            ) : uploadedFile ? (
              <div className="relative flex items-center justify-center w-full h-full">
                <FileText className="w-5 h-5 text-primary" />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(); }}
                  className="absolute -top-1 -left-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <Upload className="w-5 h-5 text-muted-foreground" />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
          </div>

          {/* Textarea + send */}
          <div className="input-field flex flex-1 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={uploadedFile ? `שאלו על "${uploadedFile.name}"...` : activeMode.placeholder}
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans resize-none"
              dir="rtl"
            />
            <button
              onClick={handleSubmit}
              disabled={loading || question.trim().length < 5}
              className="btn-send px-4 py-2.5 m-1.5 text-primary-foreground text-base flex-shrink-0 disabled:text-muted-foreground"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
              ) : (
                "⇧"
              )}
            </button>
          </div>
        </div>

        {/* File name indicator */}
        {uploadedFile && (
          <p className="text-[10px] text-muted-foreground">
            📎 {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(0)} KB)
            {extractedText ? ` • ${(extractedText.length / 1000).toFixed(0)}K תווים` : ""}
          </p>
        )}
      </div>

      {/* Scrollable result area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-4 pb-4">
        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">⚖️</div>
            <h2 className="text-foreground text-lg font-bold mb-2">העוזר המשפטי</h2>
            <p className="text-muted-foreground text-sm">
              {uploadedFile
                ? "שאלו שאלה על המסמך שהועלה – התשובה תתבסס על תוכן הקובץ ועל המאגר הפנימי"
                : "שאלו שאלה משפטית וקבלו חוות דעת מקצועית עם הפניות למקורות אמיתיים"}
            </p>
          </div>
        )}

        {/* Inline error */}
        {!result && !loading && error && (
          <Card className="mt-4 border-destructive/30 bg-destructive/5">
            <CardContent className="p-6 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
              <p className="text-foreground text-sm font-medium">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setError(null); handleSubmit(); }}
                className="gap-1.5"
              >
                נסו שוב
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading skeleton with memo structure */}
        {loading && (
          <Card className="mt-4 border-border">
            <CardContent className="p-4 sm:p-6 space-y-5">
              <div>
                <Skeleton className="h-5 w-24 mb-3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full mt-2" />
              </div>
              <div>
                <Skeleton className="h-5 w-32 mb-3" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-full mt-2" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </div>
              <div>
                <Skeleton className="h-5 w-28 mb-3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5 mt-2" />
              </div>
              <div className="pt-4 border-t border-border">
                <Skeleton className="h-4 w-28 mb-3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5 mt-2" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result — professional memo format */}
        {result && (
          <Card className="mt-4 border-border">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2 border-b border-border">
              <span className="text-xs text-muted-foreground font-medium">
                {TASK_MODES.find((m) => m.id === taskMode)?.label || "חוות דעת"}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
                  <Copy className="w-3.5 h-3.5" />
                  העתק
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setResult(null); setQuestion(""); }}
                  className="text-xs text-muted-foreground"
                >
                  נקה
                </Button>
              </div>
            </div>

            <CardContent className="p-4 sm:p-6">
              {/* Answer body */}
              <div
                className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap"
                style={{
                  fontFamily: DAVID_FONT,
                  fontSize: "12pt",
                  textAlign: "justify",
                  lineHeight: 1.8,
                }}
              >
                <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
              </div>

              {/* Footnotes */}
              {result.footnotes.length > 0 && (
                <div className="border-t border-border pt-4 mt-6 space-y-2">
                  <h3
                    className="font-semibold text-muted-foreground"
                    style={{ fontFamily: DAVID_FONT, fontSize: "11pt" }}
                  >
                    הערות שוליים
                  </h3>
                  <ol className="space-y-1.5">
                    {result.footnotes.map((fn) => {
                      const badge = getSourceBadge(fn.source);
                      return (
                        <li
                          key={fn.number}
                          id={`legalqa-footnote-${fn.number}`}
                          className="flex gap-2 items-start text-foreground"
                          style={{ fontFamily: DAVID_FONT, fontSize: "10pt" }}
                        >
                          <span className="text-primary font-bold shrink-0 flex items-center gap-1" style={{ fontSize: "10pt" }}>
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: badge.color }}
                              title={badge.label}
                            />
                            {fn.number}.
                          </span>
                          <div className="min-w-0">
                            <RenderBold text={fn.citation} />
                            {fn.source === "document" && (
                              <span className="text-[9px] text-accent-foreground mr-1">[מתוך הקובץ שהועלה]</span>
                            )}
                            {fn.url && (
                              <a
                                href={fn.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-0.5 mr-1.5"
                                style={{ fontSize: "9pt" }}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom attribution */}
      <div className="text-center py-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
        ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
      </div>
    </div>
  );
}
