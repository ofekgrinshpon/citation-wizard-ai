import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageBubble } from "@/components/MessageBubble";
import { LoadingDots } from "@/components/LoadingDots";
import { ManualEntry } from "@/components/ManualEntry";
import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS } from "@/data/abbreviations";
import { VerifiedAutocomplete } from "@/components/VerifiedAutocomplete";
import { toast } from "sonner";

const CITATION_EXAMPLES = [
  "פסד עא 248/86 עזבון חננשוילי נ רותם חברה לביטוח",
  "פסק דין קול העם נגד שר הפנים משנת 53",
  "חוק העונשין סעיף 34כב",
  'ע"א בנק המזרחי נגד מגדל בעניין חוק גל',
  "המאמר של גביזון על פרטיות ומשפט בעיוני משפט",
  "Atkins v. Virginia על עונש מוות",
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

type AppMode = "freetext" | "manual" | "batch";

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AppMode>("freetext");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const callAPI = async (userMessage: string, history: Message[]) => {
    const { data, error } = await supabase.functions.invoke("citation-chat", {
      body: {
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userMessage },
        ],
      },
    });

    if (error) throw error;

    if (data?.error) {
      if (data.error.includes("Rate limit")) {
        toast.error("מגבלת קצב – נסה שוב בעוד רגע");
      } else if (data.error.includes("Payment")) {
        toast.error("נדרשת הוספת קרדיטים");
      }
      throw new Error(data.error);
    }

    return data?.content || "אירעה שגיאה בעיבוד הבקשה.";
  };

  const handleSend = async () => {
    const rawText = input.trim();
    if (!rawText || loading) return;

    // Step 1: Normalize abbreviations
    const normalized = normalizeAbbreviations(rawText);

    // Step 2: Detect source type
    const sourceType = detectSourceType(normalized);
    const sourceLabel = SOURCE_TYPE_LABELS[sourceType];

    // Build enhanced prompt with classification info
    let prompt = normalized;
    if (sourceType !== "unknown") {
      prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${normalized}`;
    }

    // Show normalization info to user if text was changed
    if (normalized !== rawText) {
      toast.info("קיצורים תוקנו אוטומטית לפורמט תקני", { duration: 3000 });
    }

    setInput("");
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: rawText },
    ];
    setMessages(newMessages);
    setLoading(true);

    try {
      const reply = await callAPI(prompt, messages);
      setMessages([...newMessages, { role: "assistant", content: reply }]);
      // Save to citation history
      supabase.from("citation_history").insert({
        raw_input: rawText,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
      }).then(() => {});
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "שגיאה בחיבור לשרת. אנא נסה שנית." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const MODES: { id: AppMode; label: string; icon: string }[] = [
    { id: "freetext", label: "טקסט חופשי", icon: "✨" },
    { id: "manual", label: "הזנה ידנית", icon: "📝" },
    { id: "batch", label: "הערות שוליים", icon: "📑" },
  ];

  return (
    <div className="flex flex-col h-screen font-sans bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-3" style={{ direction: "rtl" }}>
          <div className="text-3xl">🏛</div>
          <div>
            <h1 className="text-foreground text-lg font-bold leading-tight font-sans">
              העוזמ״ש
            </h1>
            <p className="text-text-dim text-xs">
              כללי האזכור האחיד • מהדורת 2021
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`mode-tab flex items-center gap-1 ${
                  mode === m.id ? "mode-tab-active" : "mode-tab-inactive"
                }`}
              >
                <span className="text-[10px]">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button
              onClick={() => navigate("/admin")}
              className="text-xs text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
            >
              ⚙ ניהול
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <div
        className="flex-1 overflow-y-auto px-4"
        style={{ maxWidth: 860, margin: "0 auto", width: "100%" }}
      >
        {mode === "manual" ? (
          <ManualEntry />
        ) : mode === "batch" ? (
          <BatchFootnoteBuilder />
        ) : (
          <>
            {/* Welcome screen */}
            {messages.length === 0 && (
              <div className="py-10 text-center" style={{ direction: "rtl" }}>
                <div className="text-5xl mb-4">⚖️</div>
                <h2 className="text-foreground text-xl font-bold mb-2 font-sans">
                  העוזר המשפטי{" "}
                </h2>
                <p className="text-text-dim text-sm mb-2">
                  הכנס מקור משפטי בטקסט חופשי או בצורה ידנית – המערכת תזהה,
                  תסווג ותעצב את האזכור אוטומטית
                </p>
                <p className="text-text-faint text-xs mb-8">
                  🏷 מסווג סוג מקור • 📐 מציין מספר כלל • ⚠️ מתריע על פרטים חסרים
                </p>

                <div className="mb-3">
                  <p className="text-text-faint text-xs mb-3">
                    דוגמאות לניסיון:
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {CITATION_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => setInput(ex)}
                        className="example-chip"
                        style={{ direction: "rtl" }}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-8">
                  {[
                    {
                      icon: "⚖️",
                      title: "פסיקה",
                      desc: "פסקי דין ישראליים, מנדטוריים ולועזיים",
                    },
                    {
                      icon: "📜",
                      title: "חקיקה",
                      desc: "חוקי יסוד, חקיקה ראשית ומשנה",
                    },
                    {
                      icon: "📚",
                      title: "ספרות",
                      desc: "ספרים, מאמרים ומקורות מרשתת",
                    },
                  ].map((f, i) => (
                    <div key={i} className="feature-card">
                      <div className="text-2xl mb-2">{f.icon}</div>
                      <div className="text-foreground text-sm font-semibold mb-1">
                        {f.title}
                      </div>
                      <div className="text-text-dim text-xs">{f.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 pt-4">
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} />
              ))}
              {loading && <LoadingDots />}
              <div ref={chatEndRef} />
            </div>
          </>
        )}
      </div>

      {/* Input bar (only in freetext mode) */}
      {mode === "freetext" && (
        <div className="input-bar sticky bottom-0 px-4 py-3">
          <div
            className="flex gap-2.5 items-end"
            style={{ maxWidth: 860, margin: "0 auto", direction: "rtl" }}
          >
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-2.5 bg-surface border border-border rounded-xl text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all flex-shrink-0"
                title="נקה שיחה"
              >
                🗑
              </button>
            )}
            <div className="input-field flex flex-1 overflow-hidden">
              <VerifiedAutocomplete
                value={input}
                onChange={setInput}
                onSelectCitation={(citation) => {
                  setInput("");
                  const newMessages: Message[] = [
                    ...messages,
                    { role: "user", content: citation },
                    { role: "assistant", content: `✓ מאומת\n${citation}` },
                  ];
                  setMessages(newMessages);
                }}
                placeholder='הזן מקור משפטי בטקסט חופשי... (למשל: "בגץ קול העם" או "חוק העונשין סעיף 34")'
                disabled={loading}
                inputType="input"
                className="flex-1 bg-transparent border-none px-3.5 py-3 text-foreground text-sm leading-relaxed font-sans"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
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
          <div className="text-center mt-2 text-[11px] text-text-faint">
            כללי האזכור האחיד בכתיבה המשפטית • מהדורה שלישית 2021 • Bluebook
            21st ed.
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
