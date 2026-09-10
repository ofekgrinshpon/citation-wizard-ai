import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageBubble } from "@/components/MessageBubble";
import { LoadingDots } from "@/components/LoadingDots";
import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { LegalQAChat } from "@/components/LegalQAChat";
import { BillTypeSelector, type BillPublicationType } from "@/components/BillTypeSelector";
import { TreatyTypeSelector, type TreatySigningType } from "@/components/TreatyTypeSelector";

import { PublicationIntegrityCard } from "@/components/PublicationIntegrityCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOffice } from "@/hooks/useOffice";
import { useSubscription } from "@/hooks/useSubscription";
import { useCredits } from "@/hooks/useCredits";
import { useProjects } from "@/hooks/useProjects";
import { useActivityLog } from "@/hooks/useActivityLog";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS, type SourceType, RULE_REFERENCES } from "@/data/abbreviations";
import { validateAIResponse, buildEnginePromptHint, getEngineRuleReference, getMissingFieldsSummary } from "@/lib/citationValidation";
import { resolveSourceType } from "@/lib/sourceTypeClassifier";
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
import { FootnotesSection } from "@/components/FootnotesSection";
import { CitationHistorySidebar } from "@/components/CitationHistorySidebar";
import { QAHistorySidebar } from "@/components/QAHistorySidebar";
import { ReLexLogo } from "@/components/ReLexLogo";

interface Message {
  role: "user" | "assistant";
  content: string;
}

import { applyYearPreferences, isLegislationInput, extractLawNameFromInput, extractCitationFromResponse, type YearPreferences } from "@/lib/citationUtils";
import { invokeFunction } from "@/lib/functionError";

import { validateCitationInput } from "@/lib/citationInputValidation";
import { handleRefundResponse } from "@/lib/refundResponse";

interface PendingVerification {
  lawName: string;
  rawInput: string;
  fullCitation: string;
  sourceType: string | null;
  reply: string;
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


type AppMode = "freetext" | "batch" | "bibliography" | "legalqa";

const LS_KEY_INPUT_PREFIX = "legal_app_free_text_content";
const LS_KEY_MESSAGES_PREFIX = "legal_app_free_text_messages";

function getProjectKey(prefix: string, projectId: string | undefined) {
  return projectId ? `${prefix}_${projectId}` : prefix;
}

const Index = () => {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("legalqa");
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
  const [citationRefreshKey, setCitationRefreshKey] = useState(0);
  const [qaRefreshKey, setQaRefreshKey] = useState(0);
  const [qaExternalResult, setQaExternalResult] = useState<
    | { question: string; result: any; taskMode: "research" | "case_summary" | "academic_writing" }
    | { question: string; sourcesPayload: any; taskMode: "legal_source_search" }
    | { question: string; v1Payload: { answer: string; footnotes: any[] }; taskMode: "research" }
    | null
  >(null);
  const [qaExternalJob, setQaExternalJob] = useState<
    { id: string; mode: "answer" | "sources"; at: number } | null
  >(null);
  const [academicResumeSignal, setAcademicResumeSignal] = useState<number>(0);
  const [academicResumeFallback, setAcademicResumeFallback] = useState<{ question: string; result: any } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Clear any pinned history result when the active project changes, so a
  // historical result from project A does not bleed into project B.
  const lastProjectIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastProjectIdRef.current === undefined) {
      lastProjectIdRef.current = projectId ?? null;
      return;
    }
    if (lastProjectIdRef.current !== (projectId ?? null)) {
      lastProjectIdRef.current = projectId ?? null;
      setQaExternalResult(null);
    }
  }, [projectId]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { isOfficeAddin } = useOffice();
  const navigate = useNavigate();
  const subscription = useSubscription();
  const { billingPeriodEndsAt, planMeta } = useCredits();

  const { log: logActivity } = useActivityLog();

  // Require authentication — redirect unauthenticated users to login (preserve ?addin=1)
  useEffect(() => {
    if (!authLoading && !user) {
      const params = new URLSearchParams(window.location.search);
      const addin = params.get("addin");
      const target = addin
        ? `/auth?mode=login&addin=${addin}`
        : "/auth?mode=login";
      navigate(target, { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Load project-specific state when project changes
  useEffect(() => {
    try {
      const savedMessages = localStorage.getItem(getProjectKey(LS_KEY_MESSAGES_PREFIX, projectId));
      setMessages(savedMessages ? JSON.parse(savedMessages) : []);
    } catch { setMessages([]); }
    setInput(localStorage.getItem(getProjectKey(LS_KEY_INPUT_PREFIX, projectId)) || "");
    setPendingVerification(null);
    setPendingSuggestion(null);
    setPendingBillType(null);
    setPendingTreatyType(null);
    setMessageSourceTypes({});
    setMessageRawInputs({});
  }, [projectId]);

  // Persist input to localStorage on every change
  useEffect(() => {
    localStorage.setItem(getProjectKey(LS_KEY_INPUT_PREFIX, projectId), input);
  }, [input, projectId]);

  // Persist messages to localStorage
  useEffect(() => {
    localStorage.setItem(getProjectKey(LS_KEY_MESSAGES_PREFIX, projectId), JSON.stringify(messages));
  }, [messages, projectId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Show loading spinner while auth is hydrating (prevents white screen in Word add-in)
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-9 h-9 border-[3px] border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const callAPI = async (userMessage: string, history: Message[]) => {
    const requestId = crypto.randomUUID();
    const { data, errorInfo } = await invokeFunction<{ content?: string } & Record<string, unknown>>(
      "citation-chat",
      {
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userMessage },
        ],
        requestId,
      },
      { projectId },
    );

    if (errorInfo) {
      toast.error(errorInfo.message, {
        description: errorInfo.isInvalidInput ? "לא בוצע חיוב בקרדיטים." : undefined,
      });
      const err = new Error(errorInfo.code || `HTTP_${errorInfo.status ?? "ERR"}`) as Error & {
        isInvalidInput?: boolean;
        handled?: boolean;
        userMessage?: string;
      };
      err.isInvalidInput = errorInfo.isInvalidInput;
      err.handled = true;
      err.userMessage = errorInfo.message;
      throw err;
    }

    // Server signaled it auto-refunded the credit (e.g. AI returned a refusal).
    handleRefundResponse(data);

    return (data?.content as string) || "אירעה שגיאה בעיבוד הבקשה.";
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
          await subscription.incrementCount();
          setLoading(false);
          return;
        }
      }

      const reply = await callAPI(prompt, messages);
      const assistantIndex = newMessages.length;

      const validation = validateAIResponse(reply, sourceType as SourceType);
      let finalReply = reply;
      if (!validation.isComplete && validation.missingFields.length > 0) {
        const summary = getMissingFieldsSummary(validation.effectiveSourceType ?? (sourceType as SourceType), validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      // Credit already charged server-side by citation-chat (no frontend double-charge).

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: fullRawInput,
        formatted_output: extractedCitation || reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => { setCitationRefreshKey(k => k + 1); });

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
        const summary = getMissingFieldsSummary(validation.effectiveSourceType ?? (sourceType as SourceType), validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: sourceType as SourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      // Credit already charged server-side by citation-chat (no frontend double-charge).

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: fullRawInput,
        formatted_output: extractedCitation || reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => { setCitationRefreshKey(k => k + 1); });

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
    subscription.incrementCount();
    supabase.from("citation_history").insert([{
      raw_input: rawInput,
      formatted_output: verifiedReply,
      source_type: suggestion.source_type || null,
      is_verified: true,
      user_id: user?.id || null,
      project_id: currentProject?.id || null,
    }]).then(() => { setCitationRefreshKey(k => k + 1); });
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
      // Credit already charged server-side by citation-chat (no frontend double-charge).

      const extractedCitation = extractCitationFromResponse(reply);
      supabase.from("citation_history").insert([{
        raw_input: rawInput,
        formatted_output: extractedCitation || reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      }]).then(() => { setCitationRefreshKey(k => k + 1); });

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

    // Pre-validate: prevent charging credits for gibberish / empty / non-legal input.
    const validation = validateCitationInput(rawText);
    if (!validation.valid) {
      toast.error(validation.messageHe || "לא ניתן לעבד את הבקשה כי לא זוהה טקסט משפטי ברור לאזכור.", {
        description: "לא בוצע חיוב בקרדיטים.",
      });
      return;
    }

    const PINPOINT_RE = /(?:סעיף|ס['׳']|פסקה|פס['׳']|עמ['׳']|לפסק\s+דינ[וה]\s+של|בעמ['׳']|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;
    if (!subscription.loading && subscription.isLimitReached) return;

    // Step 1: Normalize abbreviations (sync)
    const normalized = normalizeAbbreviations(rawText);

    // Show normalization info to user if text was changed
    if (normalized !== rawText) {
      toast.info("קיצורים תוקנו אוטומטית לפורמט תקני", { duration: 3000 });
    }

    // Optimistically render the user bubble + loading state IMMEDIATELY,
    // before the async LLM classifier call, so the UI feels responsive.
    setInput("");
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: rawText.replace(/\[בחירת תוצאה\]\s*/g, '') },
    ];
    setMessages(newMessages);
    setLoadingMessage("🔎 מזהה סוג מקור...");
    setLoading(true);

    // Step 2: Detect source type — hybrid regex + Gemini classifier
    const resolved = await resolveSourceType(normalized);
    const sourceType = resolved.sourceType;
    const sourceLabel = SOURCE_TYPE_LABELS[sourceType];
    if (resolved.source === "llm" && resolved.llm) {
      console.log(`[classifier] LLM override → ${sourceType} (${resolved.llm.confidence}): ${resolved.llm.reason}`);
    }

    // Build enhanced prompt with classification info + engine hints
    let prompt = normalized;
    if (sourceType !== "unknown") {
      const engineHint = buildEnginePromptHint(sourceType);
      prompt = `[סיווג אוטומטי: ${sourceLabel}]\n${engineHint}${normalized}`;
    }

    // Check if this is a bill and user didn't specify הכנסת or הממשלה
    const isBillSource = sourceType === "bill" || (sourceType === "basic_law" && /הצעת/.test(rawText));
    const hasExplicitBillType = /הכנסת|הממשלה/.test(rawText);
    if (isBillSource && !hasExplicitBillType) {
      setLoading(false);
      setLoadingMessage(null);
      setPendingBillType({ rawText, normalized, sourceType: sourceType as SourceType, sourceLabel, newMessages });
      return;
    }

    // Check if this is a treaty and user didn't specify type
    const isTreatySource = sourceType === "treaty";
    const hasExplicitTreatyType = /נפתחה לחתימה|נחתמה ב|רב[- ]?צדדית|דו[- ]?צדדית/.test(rawText);
    if (isTreatySource && !hasExplicitTreatyType) {
      setLoading(false);
      setLoadingMessage(null);
      setPendingTreatyType({ rawText, normalized, sourceType: sourceType as SourceType, sourceLabel, newMessages });
      return;
    }

    // Update loading message based on query type (loading was already turned on optimistically)
    const isCaseLawQuery = sourceType === "case_law_published" || sourceType === "case_law_database";
    if (isCaseLawQuery) {
      setLoadingMessage("🔍 מחפש פרטי פסק דין...");
    } else {
      setLoadingMessage(null);
    }

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
          await subscription.incrementCount();

          supabase.from("citation_history").insert([{
            raw_input: fullRawInput,
            formatted_output: verifiedReply,
            source_type: verifiedMatch.source_type || (sourceType !== "unknown" ? sourceLabel : null),
            is_verified: true,
            user_id: user?.id || null,
            project_id: currentProject?.id || null,
          }]).then(() => { setCitationRefreshKey(k => k + 1); });
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

      // Re-classify source type based on AI output (e.g., database → published if פ"ד found)
      let effectiveSourceType = sourceType as SourceType;
      if (effectiveSourceType === "case_law_database" && /פ["״]ד\s+[א-ת]+/.test(reply)) {
        effectiveSourceType = "case_law_published";
      }

      // Post-response validation using the citation engine
      const validation = validateAIResponse(reply, effectiveSourceType);
      let finalReply = reply;
      if (!validation.isComplete && validation.missingFields.length > 0) {
        const summary = getMissingFieldsSummary(validation.effectiveSourceType ?? effectiveSourceType, validation.missingFields);
        if (summary && !/⚠️/.test(reply)) {
          finalReply = `${reply}\n⚠️ ${summary}`;
        }
      }

      setMessages([...newMessages, { role: "assistant", content: finalReply }]);
      setMessageSourceTypes((prev) => ({ ...prev, [assistantIndex]: effectiveSourceType }));
      setMessageRawInputs((prev) => ({ ...prev, [assistantIndex]: rawText }));
      // Credit already charged server-side by citation-chat (no frontend double-charge).

      // Extract the actual citation from the AI response (skip step explanations, rules, warnings)
      const extractedCitation = extractCitationFromResponse(reply);

      // Save to citation history — use the full reply for display, but the extracted citation for verification
      const citationPayload = {
        raw_input: fullRawInput,
        formatted_output: extractedCitation || reply,
        source_type: sourceType !== "unknown" ? sourceLabel : null,
        user_id: user?.id || null,
        project_id: currentProject?.id || null,
      };

      supabase.from("citation_history").insert([citationPayload]).then(() => { setCitationRefreshKey(k => k + 1); });
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
    } catch (err) {
      const e = err as Error & { isInvalidInput?: boolean; handled?: boolean; userMessage?: string; message?: string };
      if (e?.isInvalidInput || e?.message === "INVALID_INPUT" || e?.message === "INSUFFICIENT_CREDITS") {
        // Already toasted by callAPI. Roll back the user message bubble — nothing was processed.
        setMessages(messages);
      } else {
        setMessages([
          ...newMessages,
          { role: "assistant", content: e?.userMessage || "שגיאה בחיבור לשרת. אנא נסה שנית." },
        ]);
        if (!e?.handled) toast.error(e?.userMessage || "שגיאה בחיבור לשרת. אנא נסה שנית.");
      }

    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const MODES: { id: AppMode; label: string; icon: string }[] = [
    { id: "legalqa", label: "העוזר המשפטי", icon: "⚖️" },
    { id: "freetext", label: "אזכור אחיד", icon: "✨" },
    { id: "batch", label: "הערות שוליים", icon: "📑" },
    { id: "bibliography", label: "ביבליוגרפיה", icon: "📚" },
  ];

  

  return (
    <div className={`flex flex-col h-screen font-sans bg-background text-foreground ${isOfficeAddin ? "compact-mode" : ""}`}>
      {/* Guest Limit Modal */}
      {!subscription.loading && subscription.isLimitReached && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ direction: "rtl" }}>
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
          <div className="relative bg-card border border-border rounded-2xl p-6 max-w-sm mx-4 shadow-lg text-center animate-fade-in">
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-foreground text-lg font-bold mb-2">נגמרו הקרדיטים החודשיים</h3>
            <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
              ניצלת את כל {subscription.limit} הקרדיטים החודשיים בתכנית {planMeta.label}.
              {billingPeriodEndsAt ? <> הקרדיטים יתחדשו ב־{new Date(billingPeriodEndsAt).toLocaleDateString("he-IL")}.</> : null}
              {" "}ניתן לשדרג ל־Pro או להוסיף Top-up כדי להמשיך לעבוד עכשיו.
            </p>
            <button
              onClick={() => navigate("/profile?tab=account")}
              className="w-full py-3 rounded-xl font-semibold text-sm text-primary-foreground transition-all"
              style={{ background: "var(--gradient-primary)" }}
            >
              שדרג ל-Pro
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="flex flex-col border-b border-border bg-card shadow-sm">
        {/* Top row: logo + actions */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3" style={{ direction: "rtl" }}>
            {/* Mobile sidebar toggle */}
            {user && !isOfficeAddin && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                ☰
              </button>
            )}
            <ReLexLogo size={28} />
            <p className="text-text-dim text-[10px] sm:text-xs hidden sm:block">
              ReLex © 2026
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {!subscription.isSubscribed && (
              <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md">
                {subscription.remaining}/{subscription.limit} אזכורים
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
      <div className="flex flex-1 overflow-hidden items-stretch">
        {/* Right sidebar — desktop only */}
        {user && !isOfficeAddin && (
          <div className="hidden md:flex self-stretch">
            <AppSidebar />
          </div>
        )}

        {/* Main column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Main content */}
        <div
          className="flex-1 overflow-y-auto px-3 sm:px-4"
          style={{ maxWidth: 860, margin: "0 auto", width: "100%" }}
        >
        {mode === "batch" ? (
          <FootnotesSection />
        ) : mode === "bibliography" ? (
          <BibliographyGenerator />
        ) : mode === "legalqa" ? (
          <LegalQAChat
            onResultSaved={() => setQaRefreshKey(k => k + 1)}
            externalResult={qaExternalResult}
            onConsumeExternalResult={() => setQaExternalResult(null)}
            externalJob={qaExternalJob}
            academicResumeSignal={academicResumeSignal}
            academicResumeFallback={academicResumeFallback}
          />
        ) : (
          <>
            {/* Welcome screen */}
            {messages.length === 0 && (
              <div className="py-6 sm:py-10 text-center" style={{ direction: "rtl" }}>
                <div className="mb-3 sm:mb-4 flex justify-center"><ReLexLogo size={56} /></div>
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
                            // IMPORTANT: include [סיווג אוטומטי: ...] so the backend routes to the right Perplexity branch
                            const reclassifiedPrompt = `[סיווג אוטומטי: ${newLabel}]\n[תיקון סיווג: המשתמש ציין שמדובר ב${newLabel}]\n${engineHint}[כלל רלוונטי: ${getEngineRuleReference(newType)}]\n${rawInput}`;
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
                  onSelectOption={(optionText: string) => {
                    // Prepend selection tag so edge function skips Perplexity search
                    const tagged = `[בחירת תוצאה] ${optionText.replace(/^\d+\.\s*/, '')}`;
                    setInput(tagged);
                    setTimeout(() => {
                      const sendBtn = document.querySelector('.btn-send') as HTMLButtonElement;
                      if (sendBtn) sendBtn.click();
                    }, 50);
                  }}
                />
              ))}
              {loading && (
                <div className="flex flex-col items-center gap-1">
                  <LoadingDots />
                  {loadingMessage && (
                    <span className="text-xs text-muted-foreground animate-pulse">{loadingMessage}</span>
                  )}
                </div>
              )}
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
                    localStorage.removeItem(getProjectKey(LS_KEY_INPUT_PREFIX, projectId));
                    localStorage.removeItem(getProjectKey(LS_KEY_MESSAGES_PREFIX, projectId));
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
            <div className="input-field flex flex-1 min-w-0">
              <VerifiedAutocomplete
                value={input}
                onChange={setInput}
                onKeyDown={handleKeyDown}
                onSelectCitation={(citation) => {
                  setInput("");
                  const newMessages: Message[] = [
                    ...messages,
                    { role: "user", content: citation },
                    { role: "assistant", content: `✓ מאומת\n${citation}` },
                  ];
                  setMessages(newMessages);
                }}
                placeholder='הזן מקור משפטי...'
                disabled={loading}
                inputType="textarea"
                className="w-full flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans resize-none"
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
          <div className="text-center mt-1.5 sm:mt-2 text-[10px] sm:text-[11px] text-muted-foreground">
            ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
          </div>
        </div>
      )}
        </div>

        {/* Citation history sidebar — desktop only, authenticated users */}
        {user && !isOfficeAddin && (
          <div className="hidden md:flex self-stretch">
            {mode === "legalqa" ? (
              <QAHistorySidebar
                projectId={projectId ?? null}
                refreshKey={qaRefreshKey}
                onLoadResult={(question, result, taskMode) => {
                  if (taskMode === "academic_writing") {
                    setAcademicResumeFallback({ question, result });
                    setAcademicResumeSignal(Date.now());
                  } else if (taskMode === "legal_source_search") {
                    setQaExternalResult({ question, sourcesPayload: result, taskMode: "legal_source_search" });
                  } else if (
                    taskMode === "legal_research_v1" &&
                    result && typeof result === "object" && (result as any).__legal_research_v1
                  ) {
                    setQaExternalResult({
                      question,
                      v1Payload: (result as any).payload,
                      taskMode: "research",
                    });
                  } else {
                    // Defensive: coerce any unknown/legacy task_mode to "research"
                    // so we never hand the chat an unrenderable mode string.
                    const known = ["research", "case_summary", "academic_writing"] as const;
                    const safeMode = (known as readonly string[]).includes(taskMode)
                      ? (taskMode as "research" | "case_summary" | "academic_writing")
                      : "research";
                    setQaExternalResult({ question, result, taskMode: safeMode });
                  }
                }}
              />
            ) : (
              <CitationHistorySidebar
                projectId={projectId ?? null}
                refreshKey={citationRefreshKey}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
