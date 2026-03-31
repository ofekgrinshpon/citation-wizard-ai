import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MessageBubble } from "@/components/MessageBubble";
import { LoadingDots } from "@/components/LoadingDots";
import { ManualEntry } from "@/components/ManualEntry";
import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { GuestLimitModal } from "@/components/GuestLimitModal";
import { PublicationIntegrityCard } from "@/components/PublicationIntegrityCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGuestLimit } from "@/hooks/useGuestLimit";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS } from "@/data/abbreviations";
import { VerifiedAutocomplete } from "@/components/VerifiedAutocomplete";
import { toast } from "sonner";
import { ensureVerifiedSources } from "@/lib/verifiedSources";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface YearPreferences {
  hasHebrewYear: boolean;
  hasGregorianYear: boolean;
}

interface PendingVerification {
  lawName: string;
  rawInput: string;
  fullCitation: string;
  sourceType: string | null;
  reply: string;
}

const LEGISLATION_DETECT = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|חוק[\s-]יסוד|סעיף\s+[\dא-ת]+\s+ל)/;

function isLegislationInput(text: string): boolean {
  return LEGISLATION_DETECT.test(text.trim());
}

function extractLawNameFromInput(text: string): string {
  let cleaned = text.trim().replace(/^סעיף\s+[\dא-ת()./\\–-]+\s+ל/, "").trim();
  return cleaned.split(",")[0]?.trim() || cleaned;
}

/**
 * Strip Hebrew year (התש...) or Gregorian year from a citation based on prefs.
 */
function applyYearPreferences(citation: string, prefs: YearPreferences): string {
  let result = citation;
  if (!prefs.hasHebrewYear) {
    // Remove Hebrew year patterns like התשנ"ב, התשנ״ב, התש"ם etc. with optional surrounding comma/space
    result = result.replace(/,?\s*הת[שׁ]["\u05F4\u201C\u201D״]?[א-ת]["\u05F4\u201C\u201D״]?[א-ת]?/g, "");
    result = result.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/,\s*\./, ".").trim();
  }
  if (!prefs.hasGregorianYear) {
    // Remove Gregorian year like –1992, -1992, or standalone 1992
    result = result.replace(/[–\-]\s*\d{4}/g, "");
    result = result.replace(/,?\s*\d{4}/g, "");
    result = result.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/,\s*\./, ".").trim();
  }
  return result;
}

/**
 * Extract the actual formatted citation from the AI response,
 * stripping step-by-step explanations, rule references, and warnings.
 */
function extractCitationFromResponse(response: string): string {
  const lines = response.split("\n").map((l) => l.trim()).filter(Boolean);

  const citationLines = lines.filter((line) => {
    if (/^שלב \d/.test(line)) return false;
    if (/^📐/.test(line)) return false;
    if (/^⚠️/.test(line)) return false;
    if (/^העוזר המשפטי/.test(line)) return false;
    if (/^מכיוון ש/.test(line)) return false;
    if (/^הנוסחה ל/.test(line)) return false;
    return true;
  });

  return citationLines.length > 0 ? citationLines[citationLines.length - 1] : "";
}

/**
 * If current input is a fragment (number, short correction), trace back to find the original source name.
 */
function buildFullRawInput(currentInput: string, previousMessages: Message[]): string {
  const trimmed = currentInput.trim();
  const isFragment = /^\d+\.?$/.test(trimmed) || trimmed.length < 5;

  if (!isFragment || previousMessages.length === 0) return currentInput;

  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const msg = previousMessages[i];
    if (msg.role === "user" && msg.content.trim().length >= 5 && !/^\d+\.?$/.test(msg.content.trim())) {
      return msg.content;
    }
  }

  return currentInput;
}

const CITATION_EXAMPLES = [
  "פסד עא 248/86 עזבון חננשוילי נ רותם חברה לביטוח",
  "פסק דין קול העם נגד שר הפנים משנת 53",
  "חוק העונשין סעיף 34כב",
  'ע"א בנק המזרחי נגד מגדל בעניין חוק גל',
  "המאמר של גביזון על פרטיות ומשפט בעיוני משפט",
  "Atkins v. Virginia על עונש מוות",
];


type AppMode = "freetext" | "manual" | "batch" | "bibliography";

const LS_KEY_INPUT = "legal_app_free_text_content";
const LS_KEY_MESSAGES = "legal_app_free_text_messages";

const Index = () => {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY_MESSAGES);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState(() => localStorage.getItem(LS_KEY_INPUT) || "");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AppMode>("freetext");
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const guestLimit = useGuestLimit();

  const isGuest = !user;
  const isGuestMode = isGuest || searchParams.get("guest") === "true";

  // Persist input to localStorage on every change
  useEffect(() => {
    localStorage.setItem(LS_KEY_INPUT, input);
  }, [input]);

  // Persist messages to localStorage
  useEffect(() => {
    localStorage.setItem(LS_KEY_MESSAGES, JSON.stringify(messages));
  }, [messages]);

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

  const saveVerifiedSource = async (
    rawInput: string,
    fullCitation: string,
    sourceType: string | null,
    yearPrefs?: YearPreferences
  ) => {
    try {
      const result = await ensureVerifiedSources(
        [{
          rawInput,
          fullCitation,
          sourceType,
          verifiedBy: user?.id,
          autoVerified: true,
          yearPreferences: yearPrefs,
        }],
      );
      if (result.invalid > 0) {
        toast.warning("המקור נשמר לבדיקת אדמין – אימות AI זיהה חוסר עקביות");
      } else if (result.skipped > 0) {
        // Already exists
      } else if (result.added > 0) {
        toast.success("המקור אומת ונשמר בהצלחה");
      }
    } catch { /* silent */ }
  };

  const handleIntegrityConfirm = async (prefs: YearPreferences) => {
    if (!pendingVerification) return;
    const { rawInput, fullCitation, sourceType, reply } = pendingVerification;
    const adjustedCitation = applyYearPreferences(fullCitation, prefs);
    await saveVerifiedSource(rawInput, adjustedCitation, sourceType, prefs);

    // Update the displayed message to reflect the adjusted citation
    const adjustedReply = applyYearPreferences(reply, prefs);
    setMessages((prev) => {
      const updated = [...prev];
      // Find the last assistant message and update it
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].role === "assistant") {
          updated[i] = { ...updated[i], content: adjustedReply };
          break;
        }
      }
      return updated;
    });

    setPendingVerification(null);
  };

  const handleIntegrityCancel = async () => {
    if (!pendingVerification) return;
    // Save with defaults (both years present)
    const { rawInput, fullCitation, sourceType } = pendingVerification;
    await saveVerifiedSource(rawInput, fullCitation, sourceType, { hasHebrewYear: true, hasGregorianYear: true });
    setPendingVerification(null);
  };

  const handleSend = async () => {
    const rawText = input.trim();
    if (!rawText || loading) return;
    if (isGuestMode && guestLimit.isLocked) return;

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
      // Increment guest counter
      if (isGuestMode) guestLimit.increment();

      // Extract the actual citation from the AI response (skip step explanations, rules, warnings)
      const extractedCitation = extractCitationFromResponse(reply);

      // Determine the full context for rawInput:
      // If current input looks like a fragment/correction (number, short text),
      // combine with previous conversation context to get the full source name
      const fullRawInput = buildFullRawInput(rawText, messages);

      // Save to citation history — use the full reply for display, but the extracted citation for verification
      const citationPayload = {
        raw_input: fullRawInput,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
      };

      supabase.from("citation_history").insert(citationPayload).then(() => {});

      // Only verify if we have a real, complete citation (not a fragment, not missing data)
      const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
      const isFragment = !extractedCitation || extractedCitation.length < 10 || /^\d+\.?$/.test(extractedCitation.trim());

      if (isVerifiedClean && !isFragment) {
        const isLegislation = isLegislationInput(fullRawInput) || isLegislationInput(extractedCitation);

        // Check if this law already has year preferences stored
        if (isLegislation) {
          const lawName = extractLawNameFromInput(fullRawInput) || extractLawNameFromInput(extractedCitation);
          const { data: existingSources } = await supabase
            .from("verified_sources")
            .select("metadata")
            .ilike("source_name", `%${lawName.substring(0, 20)}%`)
            .limit(1);

          const existingMeta = existingSources?.[0]?.metadata as Record<string, unknown> | null;
          if (existingMeta && ("hasHebrewYear" in existingMeta)) {
            // Use stored preferences — apply them silently
            const prefs: YearPreferences = {
              hasHebrewYear: existingMeta.hasHebrewYear as boolean ?? true,
              hasGregorianYear: existingMeta.hasGregorianYear as boolean ?? true,
            };
            const adjustedCitation = applyYearPreferences(extractedCitation, prefs);
            await saveVerifiedSource(fullRawInput, adjustedCitation, citationPayload.source_type, prefs);
          } else {
            // New law — show the Publication Integrity Card
            setPendingVerification({
              lawName,
              rawInput: fullRawInput,
              fullCitation: extractedCitation,
              sourceType: citationPayload.source_type,
              reply,
            });
          }
        } else {
          // Non-legislation: verify directly
          await saveVerifiedSource(fullRawInput, extractedCitation, citationPayload.source_type);
        }
      }
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
    { id: "bibliography", label: "ביבליוגרפיה", icon: "📚" },
  ];

  return (
    <div className="flex flex-col h-screen font-sans bg-background text-foreground">
      {/* Guest Limit Modal */}
      {isGuestMode && guestLimit.isLocked && <GuestLimitModal />}
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
          {isGuestMode && (
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
              אורח • {guestLimit.remaining}/{guestLimit.max} אזכורים
            </span>
          )}
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
          <button
            onClick={() => navigate("/")}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg transition-colors"
          >
            {user ? "התנתק" : "← חזרה"}
          </button>
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
          <BatchFootnoteBuilder isGuest={isGuestMode} guestLimit={guestLimit} />
        ) : mode === "bibliography" ? (
          <BibliographyGenerator />
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
              {pendingVerification && (
                <div className="my-4">
                  <PublicationIntegrityCard
                    lawName={pendingVerification.lawName}
                    onConfirm={handleIntegrityConfirm}
                    onCancel={handleIntegrityCancel}
                  />
                </div>
              )}
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
                onClick={() => {
                  const totalLen = messages.reduce((sum, m) => sum + m.content.length, 0);
                  const doClear = () => {
                    setMessages([]);
                    setInput("");
                    localStorage.removeItem(LS_KEY_INPUT);
                    localStorage.removeItem(LS_KEY_MESSAGES);
                  };
                  if (totalLen > 100) {
                    toast("האם למחוק את כל השיחה?", {
                      action: { label: "מחק", onClick: doClear },
                      cancel: { label: "ביטול", onClick: () => {} },
                    });
                  } else {
                    doClear();
                  }
                }}
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
