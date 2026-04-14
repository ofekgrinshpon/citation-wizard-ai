import { useState, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/AppSidebar";
import { GeometricBackground } from "@/components/GeometricBackground";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { copyRichText } from "@/lib/clipboard";
import { Send, Copy, Scale, AlertTriangle, ExternalLink, StopCircle, Lock } from "lucide-react";

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

/** Render answer text with clickable superscript footnote numbers and bold **text** */
function AnswerWithFootnotes({ text, onFootnoteClick }: { text: string; onFootnoteClick: (n: number) => void }) {
  // First split on superscript numbers
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
        // Render **bold** markers as actual bold
        return <RenderBold key={i} text={part} />;
      })}
    </>
  );
}

/** Convert **text** to <strong>text</strong> */
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

/** Render footnote citation with **bold** support */
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

export default function LegalQA() {
  const { user, loading: authLoading } = useAuth();
  const { isLimitReached, remaining, incrementCount, loading: subLoading, limit } = useSubscription();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const footnotesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  if (authLoading || subLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  const handleSubmit = async () => {
    if (isLimitReached) {
      setShowLimitDialog(true);
      return;
    }

    const q = question.trim();
    if (!q || q.length < 5) {
      toast.error("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }

    setLoading(true);
    setResult(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${supabaseUrl}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? supabaseKey}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      setResult(data as QAResult);
      await incrementCount();
    } catch (e: any) {
      if (e.name === "AbortError") return; // user cancelled
      console.error("Legal QA error:", e);
      toast.error("שגיאה בעיבוד השאלה. נסו שוב.");
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    toast.info("העיבוד הופסק");
  };

  const handleCopy = () => {
    if (!result) return;

    const mdToHtml = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const mdToPlain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1");

    const bodyStyle = 'font-family: David, "David Libre", serif; font-size: 12pt; line-height: 1.5; text-align: justify; direction: rtl;';
    const fnStyle = 'font-family: David, "David Libre", serif; font-size: 10pt; line-height: 1.5; direction: rtl;';

    const answerHtml = mdToHtml(result.answer).replace(/\n/g, "<br>");
    const footnotesHtml = result.footnotes
      .map((f) => `<div style="${fnStyle}"><strong>${f.number}.</strong> ${mdToHtml(f.citation)}</div>`)
      .join("");

    const html = `<div style="${bodyStyle}">${answerHtml}</div>` +
      (result.footnotes.length > 0 ? `<hr><div style="${fnStyle}"><strong>הערות שוליים</strong></div>${footnotesHtml}` : "");

    const footnotesPlain = result.footnotes.map((f) => `${f.number}. ${mdToPlain(f.citation)}`).join("\n");
    const plain = `${mdToPlain(result.answer)}\n\nהערות שוליים:\n${footnotesPlain}`;

    copyRichText(html, plain);
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
              <h1 className="text-2xl font-bold text-foreground">שאלה משפטית</h1>
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
                className="min-h-[100px] text-base resize-none"
                dir="rtl"
              />
              <div className="flex justify-end">
                {loading ? (
                  <Button variant="destructive" onClick={handleStop} className="gap-2">
                    <StopCircle className="w-4 h-4" />
                    עצור
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={question.trim().length < 5 || isLimitReached}
                    className="gap-2"
                  >
                    {isLimitReached ? <Lock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    {isLimitReached ? "המכסה אזלה" : "שאל שאלה משפטית"}
                  </Button>
                )}
              </div>
              {remaining !== Infinity && (
                <p className="text-xs text-muted-foreground text-left mt-1">
                  {isLimitReached
                    ? `הגעת למגבלת ${limit} שאילתות חינמיות`
                    : `נותרו ${remaining} שאילתות מתוך ${limit}`}
                </p>
              )}
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

          {/* Result — David font only here */}
          {result && (
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Answer body - David 12pt, justified */}
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

                {/* Footnotes - David 10pt */}
                {result.footnotes.length > 0 && (
                  <div ref={footnotesRef} className="border-t border-border pt-4 space-y-2">
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
                          id={`footnote-${fn.number}`}
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Limit reached dialog */}
        <Dialog open={showLimitDialog} onOpenChange={setShowLimitDialog}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 justify-center">
                <Lock className="w-5 h-5 text-destructive" />
                המכסה החינמית אזלה
              </DialogTitle>
              <DialogDescription className="text-center">
                ניצלת את {limit} השאילתות החינמיות. לשימוש ללא הגבלה, שדרגו למנוי.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={() => { setShowLimitDialog(false); navigate("/profile"); }}>
                שדרוג מנוי
              </Button>
              <Button variant="outline" onClick={() => setShowLimitDialog(false)}>
                סגור
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
