import { useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/AppSidebar";
import { GeometricBackground } from "@/components/GeometricBackground";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { copyPlainText } from "@/lib/clipboard";
import { Send, Copy, Scale, AlertTriangle, ExternalLink } from "lucide-react";

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

const SOURCE_TYPE_LABELS: Record<string, string> = {
  legislation: "חקיקה",
  caselaw: "פסיקה",
  book: "ספר",
  article: "מאמר",
  international: "בינלאומי",
};

const SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹";

/** Render answer text with clickable superscript footnote numbers */
function AnswerWithFootnotes({ text, onFootnoteClick }: { text: string; onFootnoteClick: (n: number) => void }) {
  // Split on superscript numbers like ¹ ² ³ etc.
  const parts = text.split(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        // Check if this part is a superscript number
        const num = superscriptToNumber(part);
        if (num !== null) {
          return (
            <sup
              key={i}
              className="text-primary cursor-pointer hover:underline font-bold"
              style={{ fontSize: "10px", fontFamily: "David, 'David Libre', serif" }}
              onClick={() => onFootnoteClick(num)}
            >
              {part}
            </sup>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

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

export default function LegalQA() {
  const { user, loading: authLoading } = useAuth();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const footnotesRef = useRef<HTMLDivElement>(null);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

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
    const el = document.getElementById(`footnote-${num}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="flex h-screen overflow-hidden" dir="rtl">
      <AppSidebar />
      <main className="flex-1 relative overflow-y-auto">
        <GeometricBackground />
        <div className="relative z-10 max-w-3xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Scale className="w-7 h-7 text-primary" />
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "David, 'David Libre', serif" }}>
                שאלה משפטית
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              שאלו שאלה משפטית וקבלו תשובה מקצועית עם הפניות למקורות אמיתיים
            </p>
          </div>

          {/* Disclaimer */}
          <Alert className="border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive text-xs">
              תשובות ReLex הן בגדר עזר בלבד ואינן מהוות ייעוץ משפטי. יש לבדוק את המקורות באופן עצמאי.
            </AlertDescription>
          </Alert>

          {/* Input */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="לדוגמה: מהם התנאים לביטול חוזה עקב הטעיה לפי הדין הישראלי?"
                className="min-h-[100px] resize-none"
                style={{ fontFamily: "David, 'David Libre', serif", fontSize: "12pt" }}
                dir="rtl"
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={loading || question.trim().length < 5}
                  className="gap-2"
                >
                  <Send className="w-4 h-4" />
                  {loading ? "מחפש מקורות..." : "שאל שאלה משפטית"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Loading */}
          {loading && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <div className="pt-4 border-t border-border mt-4">
                  <Skeleton className="h-3 w-1/3 mb-3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5 mt-2" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Result */}
          {result && (
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Answer body - David 12pt, justified */}
                <div
                  className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap"
                  style={{
                    fontFamily: "David, 'David Libre', serif",
                    fontSize: "12pt",
                    textAlign: "justify",
                    lineHeight: 1.8,
                  }}
                >
                  <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
                </div>

                {/* Footnotes - David 10pt */}
                {result.footnotes.length > 0 && (
                  <div ref={footnotesRef} className="border-t border-border pt-4 space-y-2">
                    <h3
                      className="font-semibold text-muted-foreground"
                      style={{ fontFamily: "David, 'David Libre', serif", fontSize: "11pt" }}
                    >
                      הערות שוליים
                    </h3>
                    <ol className="space-y-1.5">
                      {result.footnotes.map((fn) => (
                        <li
                          key={fn.number}
                          id={`footnote-${fn.number}`}
                          className="flex gap-2 items-start"
                          style={{ fontFamily: "David, 'David Libre', serif", fontSize: "10pt" }}
                        >
                          <span className="text-primary font-bold shrink-0" style={{ fontSize: "10pt" }}>
                            {fn.number}.
                          </span>
                          <div className="min-w-0">
                            <span className="text-foreground">{fn.citation}</span>
                            {fn.url && (
                              <a
                                href={fn.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary text-xs hover:underline inline-flex items-center gap-0.5 mr-1.5"
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
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
