import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MessageBubble } from "@/components/MessageBubble";
import { LoadingDots } from "@/components/LoadingDots";
import { ManualEntry } from "@/components/ManualEntry";
import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BillTypeSelector, type BillPublicationType } from "@/components/BillTypeSelector";
import { TreatyTypeSelector, type TreatySigningType } from "@/components/TreatyTypeSelector";
import { GuestLimitModal } from "@/components/GuestLimitModal";
import { PublicationIntegrityCard } from "@/components/PublicationIntegrityCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOffice } from "@/hooks/useOffice";
import { useGuestLimit } from "@/hooks/useGuestLimit";
import { useProjects } from "@/hooks/useProjects";
import { useActivityLog } from "@/hooks/useActivityLog";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS, type SourceType, RULE_REFERENCES } from "@/data/abbreviations";
import { validateAIResponse, buildEnginePromptHint, getEngineRuleReference, getMissingFieldsSummary } from "@/lib/citationValidation";
import { VerifiedAutocomplete } from "@/components/VerifiedAutocomplete";
import { toast } from "sonner";
import {
  classifyVerifiedSource,
  ensureVerifiedSources,
  findVerifiedSourceMatch,
  findSimilarVerifiedSource,
  getVerifiedCategoryLabel,
  type VerifiedSourceMatch,
} from "@/lib/verifiedSources";
import { VerifiedSuggestionCard } from "@/components/VerifiedSuggestionCard";
import { AppSidebar } from "@/components/AppSidebar";
import { ReLexLogo } from "@/components/ReLexLogo";

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
  // Track detected source type per assistant message index
  const [messageSourceTypes, setMessageSourceTypes] = useState<Record<number, SourceType>>({});
  // Track original user input per assistant message index (for re-classification)
  const [messageRawInputs, setMessageRawInputs] = useState<Record<number, string>>({});
  // "Did you mean?" suggestion state
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    suggestion: VerifiedSourceMatch;
    rawInput: string;
    normalized: string;
    sourceType: SourceType;
    sourceLabel: string;
  } | null>(null);
  // Pending bill type selection — when a bill is detected but user didn't specify הכנסת/הממשלה
  const [pendingBillType, setPendingBillType] = useState<{
    rawText: string;
    normalized: string;
    sourceType: SourceType;
    sourceLabel: string;
    newMessages: Message[];
  } | null>(null);
  // Pending treaty type selection — multilateral or bilateral
  const [pendingTreatyType, setPendingTreatyType] = useState<{
    rawText: string;
    normalized: string;
    sourceType: SourceType;
    sourceLabel: string;
    newMessages: Message[];
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  
  const { user, isAdmin, signOut } = useAuth();
  const { isOfficeAddin } = useOffice();
  const navigate = useNavigate();
  const guestLimit = useGuestLimit();
  const { currentProject } = useProjects();
  const { log: logActivity } = useActivityLog();

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

  const handleBillTypeSelect = async (billType: BillPublicationType) => {
    if (!pendingBillType) return;
    const { rawText, normalized, sourceType, sourceLabel, newMessages } = pendingBillType;
    setPendingBillType(null);
    setLoading(true);

    try {
      // Inject bill type info into the prompt
      const billTypeHint = billType
        ? `\n[סוג חוברת: ה"ח ${billType}]`
        : '\n[סוג חוברת: ה"ח (ללא ציון סוג)]';

      let prompt = normalized;
      if (sourceType !== "unknown") {
        const engineHint = buildEnginePromptHint(sourceType);
        prompt = `[סיווג אוטומטי: ${sourceLabel}]${billTypeHint}\n${engineHint}${normalized}`;
      }

      const fullRawInput = buildFullRawInput(rawText, messages);
      const verifiedMatch = await findVerifiedSourceMatch(normalized);

      if (verifiedMatch) {
        const normalizedSourceName = normalizeAbbreviations(verifiedMatch.source_name).toLowerCase();
        const isDirectVerifiedMatch = normalizedSourceName.includes(normalized) ||
          normalizedSourceName === normalized ||
          normalized.includes(normalizedSourceName);

        if (isDirectVerifiedMatch) {
          const verifiedCategory = getVerifiedCategoryLabel(
            classifyVerifiedSource({
              rawInput: verifiedMatch.source_name,
              fullCitation: verifiedMatch.full_citation,
              sourceType: verifiedMatch.source_type,
            })
          );
          setMessages([
            ...newMessages,
            { role: "assistant", content: `✓ מקור מאומת\n🏷️ ${verifiedCategory}\n${verifiedMatch.full_citation}` },
          ]);
          if (isGuestMode) guestLimit.increment();
          setLoading(false);
          return;
        }
      }

      const reply = await callAPI(prompt, messages);
      const assistantIndex = newMessages.length;

      const validation = validateAIResponse(reply, sourceType as SourceType);
      let finalReply = reply;
      if (!validation.isComplete && validation.missingFields.length > 0) {
        const summary = getMissingFieldsSummary(sourceType as SourceType, validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      if (isGuestMode) guestLimit.increment();

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: fullRawInput,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => {});

      const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
      const isFragment = !extractedCitation || extractedCitation.length < 10;
      if (isVerifiedClean && !isFragment) {
        await saveVerifiedSource(fullRawInput, extractedCitation, sourceType !== "unknown" ? sourceLabel : null);
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "שגיאה בחיבור לשרת. אנא נסה שנית." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleTreatyTypeSelect = async (treatyType: TreatySigningType) => {
    if (!pendingTreatyType) return;
    const { rawText, normalized, sourceType, sourceLabel, newMessages } = pendingTreatyType;
    setPendingTreatyType(null);
    setLoading(true);

    try {
      const treatyHint = treatyType === "multilateral"
        ? '\n[סוג אמנה: רב-צדדית – "נפתחה לחתימה ב-{שנה}"]'
        : '\n[סוג אמנה: דו-צדדית – "נחתמה ב-{שנה}"]';

      let prompt = normalized;
      if (sourceType !== "unknown") {
        const engineHint = buildEnginePromptHint(sourceType);
        prompt = `[סיווג אוטומטי: ${sourceLabel}]${treatyHint}\n${engineHint}${normalized}`;
      }

      const fullRawInput = buildFullRawInput(rawText, messages);
      const reply = await callAPI(prompt, messages);
      const assistantIndex = newMessages.length;

      const validation = validateAIResponse(reply, sourceType as SourceType);
      let finalReply = reply;
      if (!validation.isComplete && validation.missingFields.length > 0) {
        const summary = getMissingFieldsSummary(sourceType as SourceType, validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      if (isGuestMode) guestLimit.increment();

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: fullRawInput,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => {});

      const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
      const isFragment = !extractedCitation || extractedCitation.length < 10;
      if (isVerifiedClean && !isFragment) {
        await saveVerifiedSource(fullRawInput, extractedCitation, sourceType !== "unknown" ? sourceLabel : null);
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "שגיאה בחיבור לשרת. אנא נסה שנית." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionAccept = () => {
    if (!pendingSuggestion) return;
    const { suggestion, rawInput } = pendingSuggestion;
    const verifiedReply = suggestion.full_citation;
    const verifiedCategory = getVerifiedCategoryLabel(
      classifyVerifiedSource({
        rawInput: suggestion.source_name,
        fullCitation: suggestion.full_citation,
        sourceType: suggestion.source_type,
      })
    );

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `✓ מקור מאומת\n🏷️ ${verifiedCategory}\n${verifiedReply}` },
    ]);
    if (isGuestMode) guestLimit.increment();
    supabase.from("citation_history").insert([{
      raw_input: rawInput,
      formatted_output: verifiedReply,
      source_type: suggestion.source_type || null,
      is_verified: true,
      user_id: user?.id || null,
      project_id: currentProject?.id || null,
    }]).then(() => {});
    setPendingSuggestion(null);
  };

  const handleSuggestionReject = async () => {
    if (!pendingSuggestion) return;
    const { rawInput, normalized, sourceType, sourceLabel } = pendingSuggestion;
    setPendingSuggestion(null);
    setLoading(true);
    try {
      let prompt = normalized;
      if (sourceType !== "unknown") {
        const engineHint = buildEnginePromptHint(sourceType as SourceType);
        prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${engineHint}${normalized}`;
      }
      const reply = await callAPI(prompt, messages);
      const assistantIndex = messages.length;
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawInput }));
      if (isGuestMode) guestLimit.increment();

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: rawInput,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => {});

      const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
      const isFragment = !extractedCitation || extractedCitation.length < 10 || /^\d+\.?$/.test(extractedCitation.trim());
      if (isVerifiedClean && !isFragment) {
        await saveVerifiedSource(rawInput, extractedCitation, sourceType !== "unknown" ? sourceLabel : null);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "שגיאה בחיבור לשרת. אנא נסה שנית." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const rawText = input.trim();
    if (!rawText || loading) return;
    const PINPOINT_RE = /(?:סעיף|ס['׳']|פסקה|פס['׳']|עמ['׳']|לפסק\s+דינ[וה]\s+של|בעמ['׳']|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;
    if (isGuestMode && guestLimit.isLocked) return;

    // Step 1: Normalize abbreviations
    const normalized = normalizeAbbreviations(rawText);

    // Step 2: Detect source type
    const sourceType = detectSourceType(normalized);
    const sourceLabel = SOURCE_TYPE_LABELS[sourceType];

    // Build enhanced prompt with classification info + engine hints
    let prompt = normalized;
    if (sourceType !== "unknown") {
      const engineHint = buildEnginePromptHint(sourceType);
      prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${engineHint}${normalized}`;
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

    // Check if this is a bill and user didn't specify הכנסת or הממשלה
    const isBillSource = sourceType === "bill" || (sourceType === "basic_law" && /הצעת/.test(rawText));
    const hasExplicitBillType = /הכנסת|הממשלה/.test(rawText);
    if (isBillSource && !hasExplicitBillType) {
      setPendingBillType({ rawText, normalized, sourceType: sourceType as SourceType, sourceLabel, newMessages });
      return;
    }

    // Check if this is a treaty and user didn't specify type
    const isTreatySource = sourceType === "treaty";
    const hasExplicitTreatyType = /נפתחה לחתימה|נחתמה ב|רב[- ]?צדדית|דו[- ]?צדדית/.test(rawText);
    if (isTreatySource && !hasExplicitTreatyType) {
      setPendingTreatyType({ rawText, normalized, sourceType: sourceType as SourceType, sourceLabel, newMessages });
      return;
    }

    setLoading(true);

    try {
      const fullRawInput = buildFullRawInput(rawText, messages);
      const isPinpoint = PINPOINT_RE.test(rawText);
      const verifiedMatch = await findVerifiedSourceMatch(normalized);

      // Short-circuit only for direct/canonical verified matches — aliases go through suggestion UI
      if (verifiedMatch && !isPinpoint) {
        const normalizedSourceName = normalizeAbbreviations(verifiedMatch.source_name).toLowerCase();
        const isDirectVerifiedMatch = normalizedSourceName.includes(normalized) ||
          normalizedSourceName === normalized ||
          normalized.includes(normalizedSourceName);

        if (isDirectVerifiedMatch) {
          const verifiedCategory = getVerifiedCategoryLabel(
            classifyVerifiedSource({
              rawInput: verifiedMatch.source_name,
              fullCitation: verifiedMatch.full_citation,
              sourceType: verifiedMatch.source_type,
            })
          );
          const verifiedReply = verifiedMatch.full_citation;
          setMessages([
            ...newMessages,
            { role: "assistant", content: `✓ מקור מאומת\n🏷️ ${verifiedCategory}\n${verifiedReply}` },
          ]);
          if (isGuestMode) guestLimit.increment();

          supabase.from("citation_history").insert([{
            raw_input: fullRawInput,
            formatted_output: verifiedReply,
            source_type: verifiedMatch.source_type || (sourceType !== "unknown" ? sourceLabel : null),
            is_verified: true,
            user_id: user?.id || null,
            project_id: currentProject?.id || null,
          }]).then(() => {});
          return;
        }
      }

      // Check for similar (fuzzy) verified source match
      if (!isPinpoint) {
        const similarMatch = verifiedMatch ?? await findSimilarVerifiedSource(normalized);
        if (similarMatch) {
          setPendingSuggestion({
            suggestion: similarMatch,
            rawInput: rawText,
            normalized,
            sourceType: sourceType as SourceType,
            sourceLabel,
          });
          setLoading(false);
          return;
        }
      }

      // If pinpoint + verified match found, inject verified source as hint into prompt
      if (isPinpoint && verifiedMatch) {
        const verifiedCategory = getVerifiedCategoryLabel(
          classifyVerifiedSource({
            rawInput: verifiedMatch.source_name,
            fullCitation: verifiedMatch.full_citation,
            sourceType: verifiedMatch.source_type,
          })
        );
        prompt = `${prompt}\n\n══ מקור מאומת (${verifiedCategory}) ══\nהשתמש בפרטים הבאים מהמקור המאומת כדי להשלים את האזכור:\nשם: ${verifiedMatch.source_name}\nאזכור מלא: ${verifiedMatch.full_citation}\n══════════════════════════════════`;
      }

      const reply = await callAPI(prompt, messages);
      const assistantIndex = newMessages.length;

      // Post-response validation using the citation engine
      const validation = validateAIResponse(reply, sourceType as SourceType);
      let finalReply = reply;
      if (!validation.isComplete && validation.missingFields.length > 0) {
        const summary = getMissingFieldsSummary(sourceType as SourceType, validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      // Increment guest counter
      if (isGuestMode) guestLimit.increment();

      // Extract the actual citation from the AI response (skip step explanations, rules, warnings)
      const extractedCitation = extractCitationFromResponse(reply);

      // Save to citation history — use the full reply for display, but the extracted citation for verification
      const citationPayload = {
        raw_input: fullRawInput,
        formatted_output: reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      };

      supabase.from("citation_history").insert([citationPayload]).then(() => {});
      logActivity("יצירת אזכור", { source_type: sourceLabel, raw_input: fullRawInput.slice(0, 100) });

      // Only verify if we have a real, complete citation (not a fragment, not missing data)
      const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
      const isFragment = !extractedCitation || extractedCitation.length < 10 || /^\d+\.?$/.test(extractedCitation.trim());
      // Don't save pinpoint references to verified sources — they are specific references, not master records

      if (isVerifiedClean && !isFragment && !isPinpoint) {
        const isLegislation = isLegislationInput(fullRawInput) || isLegislationInput(extractedCitation);

        if (isLegislation) {
          const lawName = extractLawNameFromInput(fullRawInput) || extractLawNameFromInput(extractedCitation);
          // Split into words for better matching (same as autocomplete)
          const words = lawName.split(/[\s\-:]+/).filter(w => w.length >= 2);
          const orConditions = words.map(w => `source_name.ilike.%${w}%`).join(',');

          const { data: existingSources } = await supabase
            .from("verified_sources")
            .select("metadata, verification_status")
            .or(orConditions)
            .limit(1);

          const existing = existingSources?.[0];
          const existingMeta = existing?.metadata as Record<string, unknown> | null;

          if (existing?.verification_status === "verified") {
            // Source is already verified — use stored preferences silently, skip the card
            const prefs: YearPreferences = {
              hasHebrewYear: (existingMeta?.hasHebrewYear as boolean) ?? true,
              hasGregorianYear: (existingMeta?.hasGregorianYear as boolean) ?? true,
            };
            const adjustedCitation = applyYearPreferences(extractedCitation, prefs);
            await saveVerifiedSource(fullRawInput, adjustedCitation, citationPayload.source_type, prefs);
          } else if (existingMeta && ("hasHebrewYear" in existingMeta)) {
            // Has year preferences but not fully verified — still use silently
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

  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={`flex flex-col h-screen font-sans bg-background text-foreground ${isOfficeAddin ? "compact-mode" : ""}`}>
      {/* Guest Limit Modal */}
      {isGuestMode && guestLimit.isLocked && <GuestLimitModal />}
      {/* Header */}
      <header className="flex flex-col border-b border-border bg-card shadow-sm">
        {/* Top row: logo + actions */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3" style={{ direction: "rtl" }}>
            {/* Mobile sidebar toggle */}
            {!isGuestMode && user && !isOfficeAddin && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                ☰
              </button>
            )}
            <ReLexLogo size={28} />
            <p className="text-text-dim text-[10px] sm:text-xs hidden sm:block">
              כללי האזכור האחיד • מהדורת 2021
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {isGuestMode && (
              <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md">
                אורח • {guestLimit.remaining}/{guestLimit.max}
              </span>
            )}
            <button
              onClick={async () => {
                if (user) {
                  await signOut();
                  window.location.href = "/";
                } else {
                  navigate("/");
                }
              }}
              className="text-[10px] sm:text-xs text-muted-foreground hover:text-foreground px-1.5 sm:px-2 py-1 sm:py-1.5 rounded-lg transition-colors"
            >
              {user ? "התנתק" : "← חזרה"}
            </button>
          </div>
        </div>
        {/* Mode tabs — scrollable on mobile */}
        <div className="px-2 pb-2 sm:px-4 sm:pb-3">
          <div className="flex gap-1 bg-muted rounded-lg p-0.5 sm:p-1 overflow-x-auto no-scrollbar">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`mode-tab flex items-center gap-0.5 sm:gap-1 whitespace-nowrap flex-shrink-0 ${
                  mode === m.id ? "mode-tab-active" : "mode-tab-inactive"
                }`}
              >
                <span className="text-[10px]">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-64 bg-background shadow-xl animate-fade-in">
            <div className="flex items-center justify-between px-3 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground">תפריט</span>
              <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground p-1">✕</button>
            </div>
            <AppSidebar />
          </div>
        </div>
      )}

      {/* Body with sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Right sidebar — desktop only */}
        {!isGuestMode && user && !isOfficeAddin && (
          <div className="hidden md:block">
            <AppSidebar />
          </div>
        )}

        {/* Main column */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Main content */}
        <div
          className="flex-1 overflow-y-auto px-3 sm:px-4"
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
              <div className="py-6 sm:py-10 text-center" style={{ direction: "rtl" }}>
                <div className="mb-3 sm:mb-4 flex justify-center"><ReLexLogo size={36} /></div>
                <h2 className="text-foreground text-xl font-bold mb-2 font-sans">
                  {"\n"}
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mt-6 sm:mt-8">
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
                <MessageBubble
                  key={i}
                  msg={msg}
                  detectedType={msg.role === "assistant" ? messageSourceTypes[i] : undefined}
                  onEdit={
                    msg.role === "user"
                      ? async (newContent: string) => {
                          // Replace user message and remove the following assistant message, then re-generate
                          const updatedMessages = [...messages];
                          updatedMessages[i] = { role: "user", content: newContent };
                          // Remove the assistant response that follows (if exists)
                          if (i + 1 < updatedMessages.length && updatedMessages[i + 1].role === "assistant") {
                            updatedMessages.splice(i + 1, 1);
                          }
                          setMessages(updatedMessages);
                          setLoading(true);
                          try {
                            const normalized = normalizeAbbreviations(newContent);
                            const sourceType = detectSourceType(normalized);
                            const sourceLabel = SOURCE_TYPE_LABELS[sourceType];
                            let prompt = normalized;
                            if (sourceType !== "unknown") {
                              const engineHint = buildEnginePromptHint(sourceType);
                              prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${engineHint}${normalized}`;
                            }

                            // Check verified sources first
                            const verifiedMatch = await findVerifiedSourceMatch(normalized);
                            if (verifiedMatch) {
                              const normalizedSourceName = normalizeAbbreviations(verifiedMatch.source_name).toLowerCase();
                              const isDirectVerifiedMatch = normalizedSourceName.includes(normalized) ||
                                normalizedSourceName === normalized ||
                                normalized.includes(normalizedSourceName);

                              if (isDirectVerifiedMatch) {
                                const verifiedCategory = getVerifiedCategoryLabel(
                                  classifyVerifiedSource({
                                    rawInput: verifiedMatch.source_name,
                                    fullCitation: verifiedMatch.full_citation,
                                    sourceType: verifiedMatch.source_type,
                                  })
                                );
                                const verifiedReply = verifiedMatch.full_citation;
                                setMessages([
                                  ...updatedMessages,
                                  { role: "assistant", content: `✓ מקור מאומת\n🏷️ ${verifiedCategory}\n${verifiedReply}` },
                                ]);
                              } else {
                                setPendingSuggestion({
                                  suggestion: verifiedMatch,
                                  rawInput: newContent,
                                  normalized,
                                  sourceType: sourceType as SourceType,
                                  sourceLabel,
                                });
                              }
                            } else {
                              const reply = await callAPI(prompt, updatedMessages.slice(0, i));
                              const assistantIndex = updatedMessages.length;
                              setMessages([...updatedMessages, { role: "assistant", content: reply }]);
                              setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
                              setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: newContent }));

                              const extractedCitation = extractCitationFromResponse(reply);
                              const isVerifiedClean = !/\[חסר:/.test(reply) && !/⚠️/.test(reply);
                              const isFragment = !extractedCitation || extractedCitation.length < 10;
                              if (isVerifiedClean && !isFragment) {
                                await saveVerifiedSource(newContent, extractedCitation, sourceType !== "unknown" ? sourceLabel : null);
                              }
                            }
                          } catch {
                            setMessages([...updatedMessages, { role: "assistant", content: "שגיאה בחיבור לשרת. אנא נסה שנית." }]);
                          } finally {
                            setLoading(false);
                          }
                        }
                      : undefined
                  }
                  onChangeSourceType={
                    msg.role === "assistant"
                      ? async (newType: SourceType) => {
                          const rawInput = messageRawInputs[i] || "";
                          if (!rawInput) return;
                          setMessageSourceTypes((prev) => ({ ...prev, [i]: newType }));
                          setLoading(true);
                          try {
                            const newLabel = SOURCE_TYPE_LABELS[newType];
                            const engineHint = buildEnginePromptHint(newType);
                            const reclassifiedPrompt = `[תיקון סיווג: המשתמש ציין שמדובר ב${newLabel}]\n${engineHint}[כלל רלוונטי: ${getEngineRuleReference(newType)}]\n${rawInput}`;
                            const reply = await callAPI(reclassifiedPrompt, messages.slice(0, i));
                            setMessages((prev) => {
                              const updated = [...prev];
                              updated[i] = { role: "assistant", content: reply };
                              return updated;
                            });
                          } catch {
                            toast.error("שגיאה בעיבוד מחדש");
                          } finally {
                            setLoading(false);
                          }
                        }
                      : undefined
                  }
                  onUpdateAssistantContent={
                    msg.role === "assistant"
                      ? (newContent: string) => {
                          setMessages((prev) => {
                            const updated = [...prev];
                            updated[i] = { ...updated[i], content: newContent };
                            return updated;
                          });
                          toast.success("האזכור עודכן בהצלחה");
                        }
                      : undefined
                  }
                />
              ))}
              {loading && <LoadingDots />}
              {pendingSuggestion && (
                <div className="my-4">
                  <VerifiedSuggestionCard
                    suggestion={pendingSuggestion.suggestion}
                    onAccept={handleSuggestionAccept}
                    onReject={handleSuggestionReject}
                  />
                </div>
              )}
              {pendingBillType && (
                <div className="my-4">
                  <BillTypeSelector onSelect={handleBillTypeSelect} />
                </div>
              )}
              {pendingTreatyType && (
                <div className="my-4">
                  <TreatyTypeSelector onSelect={handleTreatyTypeSelect} />
                </div>
              )}
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
        <div className="input-bar sticky bottom-0 px-2 sm:px-4 py-2 sm:py-3">
          <div
            className="flex gap-1.5 sm:gap-2.5 items-end"
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
                className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-3.5 py-3 text-foreground text-sm leading-relaxed font-sans"
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
      </div>
    </div>
  );
};

export default Index;
