import { useState } from "react";
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

const SOURCE_TYPE_ICONS: Record<string, string> = {
  legislation: "📜",
  caselaw: "⚖️",
  book: "📚",
  article: "📄",
  international: "🌐",
};

export default function LegalQA() {
  const { user, loading: authLoading } = useAuth();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);

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
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
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
                {/* Answer */}
                <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap">
                  {result.answer}
                </div>

                {/* Footnotes */}
                {result.footnotes.length > 0 && (
                  <div className="border-t border-border pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">הערות שוליים</h3>
                    <ol className="space-y-2">
                      {result.footnotes.map((fn) => (
                        <li key={fn.number} className="text-sm flex gap-2 items-start">
                          <span className="text-primary font-bold text-xs mt-0.5 shrink-0">
                            {fn.number}.
                          </span>
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span>{SOURCE_TYPE_ICONS[fn.source_type] || "📌"}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {SOURCE_TYPE_LABELS[fn.source_type] || fn.source_type}
                              </span>
                            </div>
                            <p className="text-foreground">{fn.citation}</p>
                            {fn.url && (
                              <a
                                href={fn.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary text-xs hover:underline inline-flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                מקור
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
