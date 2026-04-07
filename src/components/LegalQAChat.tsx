import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { copyPlainText } from "@/lib/clipboard";
import { Send, Copy, AlertTriangle, ExternalLink } from "lucide-react";

interface Footnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
}

interface QAResult {
  answer: string;
  footnotes: Footnote[];
  source_urls: string[];
}

const DAVID_FONT = "David, 'David Libre', serif";

function superscriptToNumber(s: string): number | null {
  const map: Record<string, string> = {
    "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
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
  const parts = text.split(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        const num = superscriptToNumber(part);
        if (num !== null) {
          return (
            <sup
              key={i}
              className="text-primary cursor-pointer hover:underline font-bold"
              style={{ fontSize: "10px", fontFamily: DAVID_FONT }}
              onClick={() => onFootnoteClick(num)}
            >
              {part}
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

function CitationText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((segment, i) =>
        i % 2 === 1 ? <strong key={i}>{segment}</strong> : <span key={i}>{segment}</span>
      )}
    </>
  );
}

export function LegalQAChat() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [result]);

  const handleSubmit = async () => {
    const q = question.trim();
    if (!q || q.length < 5) {
      toast.error("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("legal-qa", {
        body: { question: q },
      });

      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      setResult(data as QAResult);
    } catch (e: any) {
      console.error("Legal QA error:", e);
      toast.error("שגיאה בעיבוד השאלה. נסו שוב.");
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

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 pt-4" style={{ direction: "rtl" }}>
        {/* Disclaimer */}
        <Alert className="border-destructive/30 bg-destructive/5 mb-4">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <AlertDescription className="text-destructive text-[10px]">
            תשובות ReLex הן בגדר עזר בלבד ואינן מהוות ייעוץ משפטי. יש לבדוק את המקורות באופן עצמאי.
          </AlertDescription>
        </Alert>

        {/* Empty state */}
        {!result && !loading && (
          <div className="py-10 text-center">
            <div className="text-4xl mb-3">⚖️</div>
            <h2 className="text-foreground text-lg font-bold mb-2">שאלה משפטית</h2>
            <p className="text-muted-foreground text-sm">
              שאלו שאלה משפטית וקבלו תשובה מקצועית עם הפניות למקורות אמיתיים
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4 py-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <div className="pt-4 border-t border-border mt-4">
              <Skeleton className="h-3 w-1/3 mb-3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5 mt-2" />
            </div>
          </div>
        )}

        {/* Result — David font only here */}
        {result && (
          <div className="space-y-6 pb-4">
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
              <div className="border-t border-border pt-4 space-y-2">
                <h3
                  className="font-semibold text-muted-foreground"
                  style={{ fontFamily: DAVID_FONT, fontSize: "11pt" }}
                >
                  הערות שוליים
                </h3>
                <ol className="space-y-1.5">
                  {result.footnotes.map((fn) => (
                    <li
                      key={fn.number}
                      id={`legalqa-footnote-${fn.number}`}
                      className="flex gap-2 items-start text-foreground"
                      style={{ fontFamily: DAVID_FONT, fontSize: "10pt" }}
                    >
                      <span className="text-primary font-bold shrink-0" style={{ fontSize: "10pt" }}>
                        {fn.number}.
                      </span>
                      <div className="min-w-0">
                        <CitationText text={fn.citation} />
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
                  ))}
                </ol>
              </div>
            )}

            {/* Copy button */}
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />
                העתק תשובה
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom input bar — matches freetext style */}
      <div className="input-bar sticky bottom-0 px-2 sm:px-4 py-2 sm:py-3">
        <div
          className="flex gap-1.5 sm:gap-2.5 items-end"
          style={{ maxWidth: 860, margin: "0 auto", direction: "rtl" }}
        >
          {result && (
            <button
              onClick={() => {
                setResult(null);
                setQuestion("");
              }}
              className="p-2.5 bg-surface border border-border rounded-xl text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all flex-shrink-0"
              title="נקה תשובה"
            >
              🗑
            </button>
          )}
          <div className="input-field flex flex-1 overflow-hidden">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="שאלו שאלה משפטית..."
              disabled={loading}
              className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans"
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
        <div className="text-center mt-1.5 sm:mt-2 text-[10px] sm:text-[11px] text-muted-foreground">
          ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
        </div>
      </div>
    </div>
  );
}
