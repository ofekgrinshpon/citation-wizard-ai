import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useProjects } from "@/hooks/useProjects";
import { safeStorage } from "@/lib/safeStorage";

import { toast } from "sonner";
import { copyRichText } from "@/lib/clipboard";
import { Send, Copy, AlertTriangle, ExternalLink, Upload, X, FileText, Search, FileSearch, BookOpen, GraduationCap, StopCircle, Plus, Trash2, ChevronRight, ChevronLeft, Check, Lock, Wand2, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CaseSummaryReport } from "@/components/CaseSummaryReport";

// ─── Abstract chapter helpers ──────────────────────────────────────
const ABSTRACT_LOCKED_TOOLTIP = "ניתן לייצר תקציר רק לאחר השלמת כל פרקי העבודה, כדי להבטיח שהוא משקף את המחקר במלואו";
function isAbstractChapter(title: string): boolean {
  if (!title) return false;
  const t = title.trim().toLowerCase();
  return t === "תקציר" || t === "abstract" || t.startsWith("תקציר") || t.startsWith("abstract");
}
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
  refusal?: boolean;
  message?: string;
  case_summary?: boolean;
  verified_source?: "user" | "local" | "external" | "none";
  case_metadata?: {
    title?: string | null;
    citation?: string | null;
    court?: string | null;
    decision_date?: string | null;
    case_number?: string | null;
    parties?: string | null;
    year?: string | null;
    source_url?: string | null;
  };
}

type TaskMode = "research" | "pleading_analysis" | "case_summary" | "academic_writing";

const FILE_RELEVANT_MODES: TaskMode[] = ["pleading_analysis", "case_summary", "academic_writing"];

const TASK_MODES: { id: TaskMode; label: string; description: string; placeholder: string; icon: LucideIcon }[] = [
  { id: "research", label: "מחקר משפטי", description: "סריקה מקיפה עם מסגרת נורמטיבית מלאה", placeholder: "תארו שאלה משפטית לסקירה מקיפה...", icon: Search },
  { id: "pleading_analysis", label: "ניתוח כתב טענה", description: "זיהוי חולשות, סתירות ואזכורים חסרים", placeholder: "הדביקו כתב טענה או העלו קובץ לניתוח...", icon: FileSearch },
  { id: "case_summary", label: "סיכום פסיקה", description: "תמצית: עובדות, שאלה משפטית, הכרעה ורציו", placeholder: "הזינו שם פסק דין או הדביקו טקסט לסיכום...", icon: BookOpen },
  { id: "academic_writing", label: "כתיבה אקדמית", description: "ליווי בכתיבת סמינריונים ומאמרים אקדמיים בשלבים", placeholder: "תארו נושא מחקר או שאלת מחקר...", icon: GraduationCap },
];

const DAVID_FONT = "David, 'David Libre', serif";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DOC_TEXT = 30000;

// ─── Academic wizard types ──────────────────────────────────────────

type WizardStep = "init" | "topic_or_question" | "outline" | "writing" | "checkpoint" | "done";

interface ChapterData {
  title: string;
  content: string | null;
}

interface AcademicSession {
  wizardStep: WizardStep;
  maxReachedStep: WizardStep;
  currentChapter: number;
  chapters: ChapterData[];
  researchQuestion: string;
  outline: string;
  proposedQuestions?: string[];
  lastAcademicAction?: string | null;
}

/** Parse 3 proposed research questions from AI text.
 * Primary format: lines starting with "**שאלה N:** <question>" (sub-bullets ignored).
 * Fallback: legacy numbered list "1. ... 2. ... 3. ...".
 */
function parseProposedQuestions(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");

  // Primary: look for "שאלה N:" markers (with optional ** bold)
  const questionRegex = /^\*{0,2}\s*שאלה\s+(\d+)\s*[:.\-–]\s*\*{0,2}\s*(.*)$/;
  const primary: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(questionRegex);
    if (m) {
      const q = m[2].replace(/\*\*/g, "").replace(/__/g, "").trim();
      if (q.length > 0) primary.push(q);
    }
  }
  if (primary.length >= 2) {
    return primary
      .map(s => s.replace(/\*\*/g, "").trim())
      .filter(s => s.length > 5)
      .slice(0, 3);
  }

  // Fallback: legacy numbered list (1. ... 2. ... 3. ...)
  const items: string[] = [];
  let current = "";
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(\d+)[.)]\s*(.+)$/);
    if (m) {
      if (current) items.push(current.trim());
      current = m[2];
    } else if (current && line) {
      current += " " + line;
    } else if (!line && current) {
      items.push(current.trim());
      current = "";
    }
  }
  if (current) items.push(current.trim());
  return items
    .map(s => s.replace(/\*\*/g, "").replace(/__/g, "").trim())
    .filter(s => s.length > 5)
    .slice(0, 3);
}

const WIZARD_STEP_ORDER: WizardStep[] = ["init", "topic_or_question", "outline", "writing", "checkpoint", "done"];

function stepIndex(step: WizardStep): number {
  return WIZARD_STEP_ORDER.indexOf(step);
}

function isStepAfter(a: WizardStep, b: WizardStep): boolean {
  return stepIndex(a) > stepIndex(b);
}

const ACADEMIC_SESSION_KEY = (projectId?: string) => 
  projectId ? `relex_academic_session_${projectId}` : "relex_academic_session";

function loadAcademicSession(projectId?: string): AcademicSession | null {
  try {
    const raw = safeStorage.getItem(ACADEMIC_SESSION_KEY(projectId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveAcademicSession(session: AcademicSession, projectId?: string) {
  try {
    safeStorage.setItem(ACADEMIC_SESSION_KEY(projectId), JSON.stringify(session));
  } catch { /* silent */ }
}

function clearAcademicSession(projectId?: string) {
  try {
    safeStorage.removeItem(ACADEMIC_SESSION_KEY(projectId));
  } catch { /* silent */ }
}

// ─── DB-backed academic session sync ───────────────────────────────
// Persists wizard state to academic_sessions table so users can resume
// from any browser/device, not just the one that wrote localStorage.

async function loadAcademicSessionFromDB(projectId?: string): Promise<AcademicSession | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    let q = supabase
      .from("academic_sessions")
      .select("*")
      .eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return {
      wizardStep: data.wizard_step as WizardStep,
      maxReachedStep: data.max_reached_step as WizardStep,
      currentChapter: data.current_chapter ?? 0,
      chapters: (data.chapters as unknown as ChapterData[]) || [],
      researchQuestion: data.research_question || "",
      outline: data.outline || "",
      proposedQuestions: (data.proposed_questions as unknown as string[]) || [],
      lastAcademicAction: data.last_academic_action || null,
    };
  } catch { return null; }
}

async function saveAcademicSessionToDB(session: AcademicSession, projectId?: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      user_id: user.id,
      project_id: projectId ?? null,
      wizard_step: session.wizardStep,
      max_reached_step: session.maxReachedStep,
      current_chapter: session.currentChapter,
      chapters: session.chapters as unknown as any,
      research_question: session.researchQuestion,
      outline: session.outline,
      proposed_questions: (session.proposedQuestions || []) as unknown as any,
      last_academic_action: session.lastAcademicAction ?? null,
    };
    // Upsert by (user_id, project_id) — matches the unique index that treats NULL project as a single slot.
    let q = supabase.from("academic_sessions").select("id").eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data: existing } = await q.maybeSingle();
    if (existing?.id) {
      await supabase.from("academic_sessions").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("academic_sessions").insert(payload);
    }
  } catch { /* silent */ }
}


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
              style={{ fontSize: "10px" }}
              onClick={() => onFootnoteClick(num)}
            >
              {bracketMatch ? num : part}
            </sup>
          );
        }
        return <RenderMarkdown key={i} text={part} />;
      })}
    </>
  );
}

function RenderMarkdownLine({ line }: { line: string }) {
  const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = headingMatch[2];
    const className = level <= 2 ? "text-base font-bold" : "text-sm font-semibold";
    return <div className={className}><RenderBold text={content} /></div>;
  }
  return <RenderBold text={line} />;
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

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <RenderMarkdownLine line={line} />
        </span>
      ))}
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
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.slice(0, MAX_DOC_TEXT);
}

// ─── Main Component ──────────────────────────────────────────────────

interface LegalQAChatProps {
  onResultSaved?: () => void;
  externalResult?: { question: string; result: QAResult; taskMode: TaskMode } | null;
  academicResumeSignal?: number;
  academicResumeFallback?: { question: string; result: QAResult } | null;
}

export function LegalQAChat({ onResultSaved, externalResult, academicResumeSignal, academicResumeFallback }: LegalQAChatProps = {}) {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskMode, setTaskMode] = useState<TaskMode>("research");

  // Multi-file support
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [extractedTexts, setExtractedTexts] = useState<Array<{ name: string; text: string }>>([]);
  const [extracting, setExtracting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Academic wizard state ───────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>("init");
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>("init");
  const [currentChapter, setCurrentChapter] = useState(0);
  const [chapters, setChapters] = useState<ChapterData[]>([]);
  const [researchQuestion, setResearchQuestion] = useState("");
  const [outline, setOutline] = useState("");
  const [proposedQuestions, setProposedQuestions] = useState<string[]>([]);
  const [lastAcademicAction, setLastAcademicAction] = useState<string | null>(null);

  // Restore academic session on mount / project change (DB first, localStorage fallback)
  useEffect(() => {
    let cancelled = false;
    if (taskMode === "academic_writing") {
      (async () => {
        const dbSaved = await loadAcademicSessionFromDB(projectId);
        const saved = dbSaved && dbSaved.wizardStep !== "init"
          ? dbSaved
          : loadAcademicSession(projectId);
        if (!cancelled && saved && saved.wizardStep !== "init") {
          setWizardStep(saved.wizardStep);
          setMaxReachedStep(saved.maxReachedStep || saved.wizardStep);
          setCurrentChapter(saved.currentChapter);
          setChapters(saved.chapters);
          setResearchQuestion(saved.researchQuestion);
          setOutline(saved.outline);
          setProposedQuestions(saved.proposedQuestions || []);
          setLastAcademicAction(saved.lastAcademicAction || null);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [projectId]);

  // Save academic session after chapter writes (localStorage immediate + DB sync)
  const persistAcademicSession = useCallback(() => {
    if (taskMode !== "academic_writing" || wizardStep === "init") return;
    const session: AcademicSession = { wizardStep, maxReachedStep, currentChapter, chapters, researchQuestion, outline, proposedQuestions, lastAcademicAction };
    saveAcademicSession(session, projectId);
    // Fire-and-forget DB sync; localStorage already has the source of truth for instant reads.
    void saveAcademicSessionToDB(session, projectId);
  }, [taskMode, wizardStep, maxReachedStep, currentChapter, chapters, researchQuestion, outline, proposedQuestions, lastAcademicAction, projectId]);



  useEffect(() => {
    persistAcademicSession();
  }, [persistAcademicSession]);

  // Beforeunload guard
  useEffect(() => {
    if (taskMode !== "academic_writing" || wizardStep === "init" || wizardStep === "done") return;
    const hasContent = chapters.some(ch => ch.content);
    if (!hasContent) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [taskMode, wizardStep, chapters]);

  // Load external result from history sidebar
  useEffect(() => {
    if (externalResult) {
      setQuestion(externalResult.question);
      setResult(externalResult.result);
      setTaskMode(externalResult.taskMode);
    }
  }, [externalResult]);

  // Resume academic session from history sidebar click (DB first, localStorage fallback)
  useEffect(() => {
    if (!academicResumeSignal) return;
    setTaskMode("academic_writing");
    (async () => {
      const dbSaved = await loadAcademicSessionFromDB(projectId);
      const saved = dbSaved && dbSaved.wizardStep !== "init"
        ? dbSaved
        : loadAcademicSession(projectId);
      if (saved && saved.wizardStep !== "init") {
        setWizardStep(saved.wizardStep);
        setMaxReachedStep(saved.maxReachedStep || saved.wizardStep);
        setChapters(saved.chapters);
        setResearchQuestion(saved.researchQuestion);
        setOutline(saved.outline);
        setProposedQuestions(saved.proposedQuestions || []);
        setLastAcademicAction(saved.lastAcademicAction || null);

        // Land on the last chapter with content (or first without — whichever is further)
        const chs = saved.chapters || [];
        let landIdx = saved.currentChapter || 0;
        const lastWritten = (() => {
          for (let i = chs.length - 1; i >= 0; i--) if (chs[i]?.content) return i;
          return -1;
        })();
        const firstEmpty = chs.findIndex(c => !c?.content);
        const candidate = Math.max(landIdx, lastWritten, firstEmpty === -1 ? landIdx : firstEmpty);
        landIdx = Math.min(Math.max(candidate, 0), Math.max(chs.length - 1, 0));
        setCurrentChapter(landIdx);

        setResult(null);
        setError(null);
        setQuestion("");
        const title = chs[landIdx]?.title || "";
        toast.success(title ? `חזרת לעבודה האקדמית — פרק נוכחי: ${title}` : "חזרת לעבודה האקדמית");
      } else if (academicResumeFallback) {
        toast.info("לא נמצאה התקדמות שמורה לפרויקט זה. ההיסטוריה מציגה רק תוצאות פרקים קודמים.");
        setQuestion(academicResumeFallback.question);
        setResult(academicResumeFallback.result);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicResumeSignal]);


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

  // Multi-file extraction
  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const validFiles: File[] = [];
    for (const file of fileArr) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" גדול מדי. מקסימום 20MB.`);
        continue;
      }
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "docx"].includes(ext || "")) {
        toast.error(`"${file.name}" — יש להעלות PDF או DOCX בלבד.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    setUploadedFiles(prev => [...prev, ...validFiles]);
    setExtracting(true);
    try {
      const newTexts: Array<{ name: string; text: string }> = [];
      await Promise.all(validFiles.map(async (file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const text = ext === "pdf" ? await extractPdfText(file) : await extractDocxText(file);
        newTexts.push({ name: file.name, text });
      }));
      setExtractedTexts(prev => [...prev, ...newTexts]);
      toast.success(`${validFiles.length} קבצים נטענו בהצלחה`);
    } catch (e) {
      console.error("File extraction error:", e);
      toast.error("שגיאה בחילוץ טקסט מקבצים.");
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const isFileRelevantMode = FILE_RELEVANT_MODES.includes(taskMode);

  const handleModeChange = useCallback((value: string) => {
    if (!value) return;
    const newMode = value as TaskMode;

    // Warn if switching away from academic_writing with progress
    if (taskMode === "academic_writing" && newMode !== "academic_writing" && wizardStep !== "init" && chapters.some(ch => ch.content)) {
      if (!window.confirm("יש לך עבודה אקדמית בתהליך. בטוח שברצונך לעבור מצב?")) return;
    }

    setTaskMode(newMode);

    // Restore wizard state when switching to academic mode (DB first, localStorage fallback)
    if (newMode === "academic_writing") {
      const localSaved = loadAcademicSession(projectId);
      // Apply localStorage immediately so the user sees something fast.
      if (localSaved && localSaved.wizardStep !== "init") {
        setWizardStep(localSaved.wizardStep);
        setMaxReachedStep(localSaved.maxReachedStep || localSaved.wizardStep);
        setCurrentChapter(localSaved.currentChapter);
        setChapters(localSaved.chapters);
        setResearchQuestion(localSaved.researchQuestion);
        setOutline(localSaved.outline);
        setProposedQuestions(localSaved.proposedQuestions || []);
        setLastAcademicAction(localSaved.lastAcademicAction || null);
      } else {
        setWizardStep("init");
        setMaxReachedStep("init");
        setCurrentChapter(0);
        setChapters([]);
        setResearchQuestion("");
        setOutline("");
        setProposedQuestions([]);
        setLastAcademicAction(null);
      }
      // Then upgrade with DB state if it has more progress (cross-device sync).
      (async () => {
        const dbSaved = await loadAcademicSessionFromDB(projectId);
        if (dbSaved && dbSaved.wizardStep !== "init") {
          setWizardStep(dbSaved.wizardStep);
          setMaxReachedStep(dbSaved.maxReachedStep || dbSaved.wizardStep);
          setCurrentChapter(dbSaved.currentChapter);
          setChapters(dbSaved.chapters);
          setResearchQuestion(dbSaved.researchQuestion);
          setOutline(dbSaved.outline);
          setProposedQuestions(dbSaved.proposedQuestions || []);
          setLastAcademicAction(dbSaved.lastAcademicAction || null);
        }
      })();
      setResult(null);
    }


    if (uploadedFiles.length > 0 && !FILE_RELEVANT_MODES.includes(newMode)) {
      toast.warning("שימו לב: הקבצים שהועלו עדיין מצורפים.", {
        action: { label: "הסר קבצים", onClick: () => removeAllFiles() },
        duration: 6000,
      });
    }
  }, [uploadedFiles, taskMode, wizardStep, chapters, projectId]);

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setExtractedTexts(prev => prev.filter((_, i) => i !== index));
  };

  const removeAllFiles = () => {
    setUploadedFiles([]);
    setExtractedTexts([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    toast.info("העיבוד הופסק");
  };

  // ─── Academic wizard helpers ─────────────────────────────────────

  const discardAcademicSession = () => {
    if (chapters.some(ch => ch.content) && !window.confirm("האם לבטל את העבודה האקדמית? כל הפרקים שנכתבו יימחקו.")) return;
    setWizardStep("init");
    setMaxReachedStep("init");
    setCurrentChapter(0);
    setChapters([]);
    setResearchQuestion("");
    setOutline("");
    setProposedQuestions([]);
    setLastAcademicAction(null);
    setResult(null);
    setQuestion("");
    clearAcademicSession(projectId);
    // Also delete the DB-persisted session so it doesn't resurface on another device.
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        let q = supabase.from("academic_sessions").delete().eq("user_id", user.id);
        q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
        await q;
      } catch { /* silent */ }
    })();
  };

  // ─── Academic navigation helpers ────────────────────────────────
  const updateWizardStep = (step: WizardStep) => {
    setWizardStep(step);
    if (isStepAfter(step, maxReachedStep)) {
      setMaxReachedStep(step);
    }
  };

  const navigateBack = () => {
    const idx = stepIndex(wizardStep);
    if (idx <= 1) return; // can't go before topic_or_question
    // Map back: writing/checkpoint → outline, outline → topic_or_question
    if (wizardStep === "writing" || wizardStep === "checkpoint") {
      setWizardStep("outline");
      setResult(null);
    } else if (wizardStep === "outline") {
      setWizardStep("topic_or_question");
      setResult(null);
    }
  };

  const navigateForward = () => {
    // Jump to maxReachedStep or next logical step
    if (wizardStep === "topic_or_question" && isStepAfter(maxReachedStep, "topic_or_question")) {
      setWizardStep(outline ? "outline" : maxReachedStep);
      // Restore result for outline view
      if (outline) setResult({ answer: outline, footnotes: [], source_urls: [] });
    } else if (wizardStep === "outline" && isStepAfter(maxReachedStep, "outline")) {
      setWizardStep(chapters.some(ch => ch.content) ? "checkpoint" : "writing");
      setResult(null);
    }
  };

  const canGoBack = wizardStep !== "init" && wizardStep !== "done" && stepIndex(wizardStep) > 1;
  const canGoForward = wizardStep !== "done" && isStepAfter(maxReachedStep, wizardStep);
  const hasWrittenContent = chapters.some(ch => ch.content);

  /** Check if submitting from a previous step would invalidate later data */
  const checkDestructiveEdit = (fromStep: WizardStep): boolean => {
    if (fromStep === "topic_or_question" && (outline || hasWrittenContent)) {
      if (!window.confirm("שים לב: שינוי שאלת המחקר יגרום למחיקת המתווה והפרקים שנכתבו. האם להמשיך?")) return false;
      setOutline("");
      setChapters([]);
      setCurrentChapter(0);
      setMaxReachedStep("topic_or_question");
      setResult(null);
    } else if (fromStep === "outline" && hasWrittenContent) {
      if (!window.confirm("שים לב: שינוי המתווה יגרום למחיקת הפרקים שנכתבו. האם להמשיך?")) return false;
      setChapters([]);
      setCurrentChapter(0);
      setMaxReachedStep("outline");
      setResult(null);
    }
    return true;
  };

  const handleAcademicSubmit = async (academicStep: string, extraBody?: Record<string, unknown>) => {
    const q = question.trim();
    if (!q && academicStep !== "write_chapter") {
      toast.error("יש להזין טקסט.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body: Record<string, unknown> = {
        question: q || researchQuestion,
        taskMode: "academic_writing",
        academicStep,
        ...extraBody,
      };

      // Include multi-file context
      if (extractedTexts.length > 0) {
        body.documentTexts = extractedTexts;
      }

      // Include previous chapters context for writing
      if (academicStep === "write_chapter") {
        const isAbstract = !!extraBody?.isAbstract;
        // For the abstract: send full content of every other chapter (cap 6,000 chars each)
        // so the AI can synthesize the entire paper. For regular chapters, keep 2,000 cap.
        const sliceCap = isAbstract ? 6000 : 2000;
        body.previousChapters = chapters
          .filter(ch => ch.content && (!isAbstract || !isAbstractChapter(ch.title)))
          .map(ch => ({ title: ch.title, content: (ch.content || "").slice(0, sliceCap) }));
        body.chapterTitle = chapters[currentChapter]?.title || "";
        body.chapterIndex = currentChapter;
        body.researchQuestion = researchQuestion;
        body.outline = outline;
      }

      if (academicStep === "propose_outline") {
        body.researchQuestion = researchQuestion;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("יש להתחבר כדי להשתמש בעוזר המשפטי.");
        return;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (res.status === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (res.status === 402) { setError("נגמרו הקרדיטים."); return; }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data?.error) { setError(data.error); return; }
      if (!data?.answer || data.answer.trim().length < 10) { setError("לא התקבלה תשובה. נסו שוב."); return; }

      const qaResult = data as QAResult;
      setResult(qaResult);

      // Track last action for UI rendering
      setLastAcademicAction(academicStep);

      // Handle wizard step transitions
      if (academicStep === "suggest_topics") {
        setProposedQuestions(parseProposedQuestions(qaResult.answer));
        updateWizardStep("topic_or_question");
      } else if (academicStep === "validate_question") {
        setProposedQuestions([]);
        updateWizardStep("topic_or_question");
      } else if (academicStep === "propose_outline") {
        setProposedQuestions([]);
        setOutline(qaResult.answer);
        updateWizardStep("outline");
      } else if (academicStep === "write_chapter") {
        // Save chapter content
        const updatedChapters = [...chapters];
        updatedChapters[currentChapter] = { ...updatedChapters[currentChapter], content: qaResult.answer };
        setChapters(updatedChapters);
        updateWizardStep("checkpoint");

        // If this completion just unlocked the abstract, surface a toast.
        const justWrittenIsAbstract = isAbstractChapter(updatedChapters[currentChapter]?.title || "");
        if (!justWrittenIsAbstract) {
          const remainingNonAbstract = updatedChapters
            .filter(ch => !isAbstractChapter(ch.title))
            .filter(ch => !ch.content).length;
          const hasAbstract = updatedChapters.some(ch => isAbstractChapter(ch.title));
          if (hasAbstract && remainingNonAbstract === 0) {
            toast.success("כל הפרקים הושלמו — ניתן לייצר תקציר");
          }
        }
      }

      // Save to qa_logs
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          await supabase.from("qa_logs").insert({
            user_id: currentUser.id,
            project_id: currentProject?.id ?? null,
            question: q || `[academic: ${academicStep}] ${researchQuestion}`,
            answer: qaResult.answer,
            footnotes: qaResult.footnotes as any,
            task_mode: "academic_writing",
            local_footnotes_count: qaResult.footnotes.filter(f => f.source === "local").length,
            perplexity_footnotes_count: qaResult.footnotes.filter(f => f.source === "perplexity").length,
            total_footnotes: qaResult.footnotes.length,
          });
          onResultSaved?.();
        }
      } catch (saveErr) {
        console.error("Failed to save QA log:", saveErr);
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.error("Academic writing error:", e);
      setError("שגיאה בעיבוד. נסו שוב.");
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const approveOutline = () => {
    const lines = outline.split("\n").filter(l => l.trim());
    const chapterTitles: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\d+\.\s*\*?\*?(.+?)\*?\*?\s*$/);
      if (match) chapterTitles.push(match[1].trim().replace(/\*\*/g, ""));
    }
    if (chapterTitles.length === 0) {
      chapterTitles.push("תקציר", "מבוא", "המסגרת הנורמטיבית", "סקירה פסיקתית ודוקטרינרית", "ניתוח ביקורתי", "סיכום ומסקנות");
    }
    setChapters(chapterTitles.map(t => ({ title: t, content: null })));
    setCurrentChapter(0);
    updateWizardStep("writing");
  };

  // Abstract gating: unlocked once every non-abstract chapter has content
  const abstractIdx = chapters.findIndex(ch => isAbstractChapter(ch.title));
  const nonAbstractChapters = chapters.filter(ch => !isAbstractChapter(ch.title));
  const completedNonAbstract = nonAbstractChapters.filter(ch => !!ch.content).length;
  const totalNonAbstract = nonAbstractChapters.length;
  const abstractUnlocked = abstractIdx === -1 || (totalNonAbstract > 0 && completedNonAbstract === totalNonAbstract);
  const missingChapterTitles = nonAbstractChapters.filter(ch => !ch.content).map(ch => ch.title);

  const writeCurrentChapter = () => {
    const isAbstract = isAbstractChapter(chapters[currentChapter]?.title || "");
    if (isAbstract && !abstractUnlocked) {
      toast.info(ABSTRACT_LOCKED_TOOLTIP);
      return;
    }
    handleAcademicSubmit("write_chapter", isAbstract ? { isAbstract: true } : undefined);
  };

  const advanceToNextChapter = () => {
    if (currentChapter < chapters.length - 1) {
      setCurrentChapter(currentChapter + 1);
      setResult(null);
      updateWizardStep("writing");
    } else {
      updateWizardStep("done");
    }
  };

  const editCurrentChapter = () => {
    setResult(null);
    setWizardStep("writing");
  };

  // ─── Chapter feedback (rewrite with instructions) ───────────────
  const [chapterFeedback, setChapterFeedback] = useState("");
  const [viewingChapterIdx, setViewingChapterIdx] = useState<number | null>(null);

  const rewriteWithFeedback = () => {
    const fb = chapterFeedback.trim();
    if (!fb) { toast.error("יש להזין הנחיות לשכתוב."); return; }
    setChapterFeedback("");
    setViewingChapterIdx(null);
    handleAcademicSubmit("write_chapter", { userFeedback: fb });
  };

  const viewChapter = (idx: number) => {
    if (chapters[idx]?.content) {
      setViewingChapterIdx(idx);
      setCurrentChapter(idx);
      setResult({ answer: chapters[idx].content!, footnotes: [], source_urls: [] });
      setWizardStep("checkpoint");
    } else {
      // Jump to write this chapter
      setViewingChapterIdx(null);
      setCurrentChapter(idx);
      setResult(null);
      setWizardStep("writing");
    }
  };

  // ─── Standard (non-academic) submit ──────────────────────────────

  const handleSubmit = async () => {
    // Academic mode has its own submit flow
    if (taskMode === "academic_writing") {
      if (wizardStep === "init" || wizardStep === "topic_or_question") return;
      return;
    }

    const q = question.trim();
    if (!q || q.length < 5) {
      toast.error("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body: Record<string, unknown> = {
        question: q,
        taskMode,
      };
      // Send multi-file context
      if (extractedTexts.length === 1) {
        body.documentText = extractedTexts[0].text;
        body.documentName = extractedTexts[0].name;
      } else if (extractedTexts.length > 1) {
        body.documentTexts = extractedTexts;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("יש להתחבר כדי להשתמש בעוזר המשפטי.");
        return;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (res.status === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (res.status === 402) { setError("נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות."); return; }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data?.error) { setError(data.error); return; }
      if (!data?.answer || data.answer.trim().length < 20) { setError("העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב."); return; }

      const qaResult = data as QAResult;
      setResult(qaResult);

      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser && !qaResult.refusal) {
          await supabase.from("qa_logs").insert({
            user_id: currentUser.id,
            project_id: currentProject?.id ?? null,
            question: q,
            answer: qaResult.answer,
            footnotes: qaResult.footnotes as any,
            task_mode: taskMode,
            local_footnotes_count: qaResult.footnotes.filter(f => f.source === "local").length,
            perplexity_footnotes_count: qaResult.footnotes.filter(f => f.source === "perplexity").length,
            total_footnotes: qaResult.footnotes.length,
          });
          onResultSaved?.();
        }
      } catch (saveErr) {
        console.error("Failed to save QA log:", saveErr);
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.error("Legal QA error:", e);
      setError("שגיאה בעיבוד השאלה. נסו שוב.");
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result && taskMode !== "academic_writing") return;

    // For academic mode, copy entire accumulated paper
    if (taskMode === "academic_writing" && chapters.some(ch => ch.content)) {
      const fullPaper = chapters
        .filter(ch => ch.content)
        .map(ch => `**${ch.title}**\n\n${ch.content}`)
        .join("\n\n---\n\n");

      const bodyHtml = fullPaper
        .replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");

      const richHtml = `<div dir="rtl" style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 2; text-align: justify; direction: rtl;">${bodyHtml}</div>`;
      copyRichText(richHtml, fullPaper);
      toast.success("העבודה הועתקה ללוח");
      return;
    }

    if (!result) return;

    const footnotesText = result.footnotes.map((f) => `${f.number}. ${f.citation}`).join("\n");
    const plainText = `${result.answer}\n\nהערות שוליים:\n${footnotesText}`;

    const bodyHtml = result.answer
      .replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");

    const footnotesHtml = result.footnotes
      .map((f) => `<span>${f.number}. ${f.citation}</span>`)
      .join("<br>");

    const richHtml = `<div dir="rtl" style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 1.5; text-align: justify; direction: rtl;">
      ${bodyHtml}
      <br><br>
      <div style="font-size: 10pt;"><strong>הערות שוליים:</strong><br>${footnotesHtml}</div>
    </div>`;

    copyRichText(richHtml, plainText);
    toast.success("הועתק ללוח");
  };

  const scrollToFootnote = (num: number) => {
    const el = document.getElementById(`legalqa-footnote-${num}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (taskMode === "academic_writing") return; // academic mode uses buttons
      handleSubmit();
    }
  };

  const getSourceBadge = (source?: string) => {
    if (source === "local") return { color: "hsl(var(--primary))", label: "מאגר מקומי" };
    if (source === "document") return { color: "hsl(var(--accent-foreground))", label: "מתוך הקובץ" };
    return { color: "hsl(var(--muted-foreground))", label: "חיפוש אינטרנט" };
  };

  const activeMode = TASK_MODES.find((m) => m.id === taskMode)!;
  const isAcademic = taskMode === "academic_writing";

  return (
    <div className="flex flex-col h-full" style={{ direction: "rtl" }}>
      {/* Top section: Disclaimer + Mode Cards */}
      <div className="px-2 sm:px-4 pt-4 pb-2 space-y-3">
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <AlertDescription className="text-destructive text-[10px]">
            תשובות ReLex הן בגדר עזר בלבד ואינן מהוות ייעוץ משפטי. יש לבדוק את המקורות באופן עצמאי.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TASK_MODES.map((m) => {
            const isSelected = taskMode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id)}
                className={`flex flex-col items-center text-center gap-1.5 rounded-xl border transition-all ${
                  result || isAcademic ? "px-2 py-2.5" : "px-3 py-3.5"
                } ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-card-foreground border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <Icon className={result || isAcademic ? "w-4 h-4" : "w-5 h-5"} />
                <span className={`font-semibold leading-tight ${result || isAcademic ? "text-[11px]" : "text-xs sm:text-sm"}`}>
                  {m.label}
                </span>
                <span className={`leading-tight opacity-80 ${result || isAcademic ? "text-[9px] hidden sm:block" : "text-[10px] sm:text-[11px]"}`}>
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Middle: scrollable results area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-4">

        {/* ── Academic Wizard UI ── */}
        {isAcademic && (
          <div className="space-y-4 py-4">
            {/* Progress stepper + nav + copy */}
            {wizardStep !== "init" && (
              <div className="space-y-2">
                {/* Clickable step indicators */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {canGoBack && (
                      <Button variant="ghost" size="sm" onClick={navigateBack} className="gap-1 text-xs h-7 px-2">
                        <ChevronRight className="w-3.5 h-3.5" />
                        חזרה
                      </Button>
                    )}
                    {canGoForward && (
                      <Button variant="ghost" size="sm" onClick={navigateForward} className="gap-1 text-xs h-7 px-2">
                        קדימה
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Persistent copy button */}
                  {hasWrittenContent && (
                    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs h-7">
                      <Copy className="w-3 h-3" />
                      העתק טקסט מלא
                    </Button>
                  )}
                </div>

                {/* Visual stepper */}
                <div className="flex items-center justify-center gap-2 text-xs">
                  {([
                    { step: "topic_or_question" as WizardStep, label: "נושא/שאלה" },
                    { step: "outline" as WizardStep, label: "מתווה" },
                    { step: "writing" as WizardStep, label: "כתיבה" },
                  ] as const).map(({ step, label }, i) => {
                    const isCurrent = wizardStep === step || (step === "writing" && (wizardStep === "checkpoint" || wizardStep === "done"));
                    const isCompleted = isStepAfter(maxReachedStep, step) || (step === "writing" && wizardStep === "done");
                    const isClickable = !isCompleted ? false : !isCurrent;
                    return (
                      <div key={step} className="flex items-center gap-2">
                        {i > 0 && <div className={`w-6 h-px ${isCompleted || isCurrent ? "bg-primary" : "bg-border"}`} />}
                        <button
                          onClick={() => {
                            if (!isClickable) return;
                            if (step === "topic_or_question") { setWizardStep("topic_or_question"); setResult(null); }
                            else if (step === "outline") { setWizardStep("outline"); setResult({ answer: outline, footnotes: [], source_urls: [] }); }
                            else if (step === "writing") { setWizardStep(chapters.some(ch => ch.content) ? "checkpoint" : "writing"); setResult(null); }
                          }}
                          disabled={!isClickable}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${
                            isCurrent
                              ? "bg-primary text-primary-foreground font-semibold"
                              : isCompleted
                                ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isCompleted && !isCurrent && <Check className="w-3 h-3" />}
                          {label}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Chapter progress bar */}
                {chapters.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {wizardStep === "done"
                          ? "העבודה הושלמה!"
                          : `פרק ${currentChapter + 1} מתוך ${chapters.length}`}
                      </span>
                      <span>{chapters.filter(ch => ch.content).length}/{chapters.length} פרקים</span>
                    </div>
                    <Progress value={(chapters.filter(ch => ch.content).length / Math.max(chapters.length, 1)) * 100} className="h-1.5" />
                  </div>
                )}
              </div>
            )}

            {/* INIT: Two paths */}
            {wizardStep === "init" && !loading && !result && (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-6">
                <GraduationCap className="w-12 h-12 text-primary" />
                <div>
                  <h2 className="text-foreground text-lg font-bold mb-2">כתיבה אקדמית</h2>
                  <p className="text-muted-foreground text-sm mb-6">עוזר מחקר אקדמי ליצירת עבודות סמינריון ומאמרים משפטיים בשלבים</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                  <Button
                    variant="outline"
                    className="flex-1 h-auto py-4 flex flex-col gap-1"
                    onClick={() => {
                      updateWizardStep("topic_or_question");
                      setQuestion("");
                    }}
                  >
                    <span className="font-semibold">יש לי נושא כללי</span>
                    <span className="text-[10px] text-muted-foreground">המערכת תציע 3 שאלות מחקר</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-auto py-4 flex flex-col gap-1"
                    onClick={() => {
                      updateWizardStep("topic_or_question");
                      setQuestion("");
                    }}
                  >
                    <span className="font-semibold">יש לי שאלת מחקר</span>
                    <span className="text-[10px] text-muted-foreground">המערכת תבדוק את כדאיותה</span>
                  </Button>
                </div>
              </div>
            )}

            {/* TOPIC/QUESTION: input + action */}
            {wizardStep === "topic_or_question" && !loading && !result && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">הזינו נושא כללי או שאלת מחקר ספציפית:</p>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="למשל: השפעת חוק-יסוד: כבוד האדם וחירותו על דיני הנזיקין..."
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm min-h-[80px] resize-none"
                  dir="rtl"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!checkDestructiveEdit("topic_or_question")) return;
                      handleAcademicSubmit("suggest_topics");
                    }}
                    disabled={question.trim().length < 5}
                    size="sm"
                  >
                    הצע שאלות מחקר
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!checkDestructiveEdit("topic_or_question")) return;
                      setResearchQuestion(question.trim());
                      handleAcademicSubmit("validate_question");
                    }}
                    disabled={question.trim().length < 10}
                    size="sm"
                  >
                    בדוק כדאיות אקדמית
                  </Button>
                </div>
              </div>
            )}

            {/* Show AI response for topic suggestions / validation */}
            {wizardStep === "topic_or_question" && result && lastAcademicAction === "suggest_topics" && proposedQuestions.length > 0 && (
              <Card className="border-border">
                <CardContent className="p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">בחרו אחת מהשאלות המוצעות:</p>
                  <div className="space-y-2">
                    {proposedQuestions.map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (!checkDestructiveEdit("topic_or_question")) return;
                          setResearchQuestion(q);
                          setQuestion(q);
                          setProposedQuestions([]);
                          setResult(null);
                          setLastAcademicAction(null);
                          handleAcademicSubmit("propose_outline", { researchQuestion: q });
                        }}
                        className="w-full text-right p-3 rounded-lg border border-border bg-background hover:bg-primary/5 hover:border-primary/40 transition-colors text-sm leading-relaxed"
                        dir="rtl"
                      >
                        <span className="font-bold text-primary ml-2">{idx + 1}.</span>
                        {q}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Bail out: clear suggestions, return to manual entry of own research question
                        setProposedQuestions([]);
                        setResult(null);
                        setLastAcademicAction(null);
                        setQuestion("");
                      }}
                    >
                      יש לי שאלת מחקר משלי
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {wizardStep === "topic_or_question" && result && lastAcademicAction !== "suggest_topics" && (
              <Card className="border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap" style={{ lineHeight: 1.8 }}>
                    <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!checkDestructiveEdit("topic_or_question")) return;
                        const rq = question.trim() || researchQuestion;
                        setResearchQuestion(rq);
                        setResult(null);
                        handleAcademicSubmit("propose_outline", { researchQuestion: rq });
                      }}
                    >
                      אשר ועבור למתווה
                    </Button>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="ניתן לערוך את שאלת המחקר..."
                      className="flex-1 rounded border border-border bg-background p-2 text-xs min-h-[36px] resize-none"
                      dir="rtl"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* OUTLINE: show proposed outline, approve/edit */}
            {wizardStep === "outline" && result && (
              <Card className="border-border">
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-bold text-foreground">מתווה מוצע</h3>
                  <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap" style={{ lineHeight: 1.8 }}>
                    <RenderMarkdown text={result.answer} />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={() => {
                      if (!checkDestructiveEdit("outline")) return;
                      approveOutline();
                    }}>
                      אשר מתווה והתחל כתיבה
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setResult(null); setWizardStep("topic_or_question"); }}>
                      חזרה לעריכה
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Clickable chapter list — visible during writing/checkpoint */}
            {(wizardStep === "writing" || wizardStep === "checkpoint") && chapters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {chapters.map((ch, idx) => {
                  const isWritten = !!ch.content;
                  const isCurrent = idx === currentChapter;
                  const isAbstract = isAbstractChapter(ch.title);
                  const isLockedAbstract = isAbstract && !abstractUnlocked && !isWritten;

                  const baseClass = `flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                    isLockedAbstract
                      ? "bg-muted/50 text-muted-foreground border-dashed border-border opacity-70 cursor-not-allowed"
                      : isCurrent
                        ? "bg-primary text-primary-foreground border-primary font-semibold"
                        : isWritten
                          ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 cursor-pointer"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80 cursor-pointer"
                  }`;

                  const handleClick = () => {
                    if (isLockedAbstract) {
                      toast.info(ABSTRACT_LOCKED_TOOLTIP);
                      return;
                    }
                    viewChapter(idx);
                  };

                  const iconNode = isLockedAbstract
                    ? <Lock className="w-3 h-3" />
                    : isAbstract && !isWritten && abstractUnlocked
                      ? <Wand2 className="w-3 h-3" />
                      : isWritten && !isCurrent
                        ? <Check className="w-3 h-3" />
                        : null;

                  const btn = (
                    <button
                      key={idx}
                      type="button"
                      onClick={handleClick}
                      aria-disabled={isLockedAbstract}
                      className={baseClass}
                    >
                      {iconNode}
                      <span className="truncate max-w-[120px]">{idx + 1}. {ch.title}</span>
                    </button>
                  );

                  if (isLockedAbstract) {
                    return (
                      <Tooltip key={idx}>
                        <TooltipTrigger asChild>{btn}</TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {ABSTRACT_LOCKED_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return btn;
                })}
              </div>
            )}

            {/* WRITING: show current chapter + write button */}
            {wizardStep === "writing" && !loading && !result && chapters.length > 0 && (() => {
              const currentTitle = chapters[currentChapter]?.title || "";
              const isAbstract = isAbstractChapter(currentTitle);
              const isLocked = isAbstract && !abstractUnlocked;
              const hasContent = !!chapters[currentChapter]?.content;

              const writeButtonLabel = isAbstract
                ? (hasContent ? "ייצר תקציר מחדש" : "ייצר תקציר")
                : (hasContent ? "כתוב מחדש" : "כתוב פרק זה");

              return (
                <Card className="border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-foreground">
                        {isAbstract ? "כתיבת תקציר" : "כתיבת פרק"}: {currentTitle}
                      </h3>
                      <span className="text-xs text-muted-foreground">פרק {currentChapter + 1} מתוך {chapters.length}</span>
                    </div>

                    {isLocked && (
                      <div className="text-xs text-muted-foreground p-2 bg-muted/40 rounded space-y-1">
                        <p>{ABSTRACT_LOCKED_TOOLTIP}</p>
                        <p>
                          הושלמו {completedNonAbstract}/{totalNonAbstract} פרקים.
                          {missingChapterTitles.length > 0 && (
                            <> נותרו: {missingChapterTitles.join("; ")}.</>
                          )}
                        </p>
                      </div>
                    )}

                    {hasContent && !isLocked && (
                      <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                        פרק זה כבר נכתב. לחצו "{writeButtonLabel}" לשכתוב.
                      </div>
                    )}

                    {isLocked ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Button size="sm" disabled className="gap-1.5 cursor-not-allowed">
                              <Lock className="w-3.5 h-3.5" />
                              ייצר תקציר
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {ABSTRACT_LOCKED_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button onClick={writeCurrentChapter} size="sm" className="gap-1.5">
                        {isAbstract && <Wand2 className="w-3.5 h-3.5" />}
                        {writeButtonLabel}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* CHECKPOINT: chapter just written */}
            {wizardStep === "checkpoint" && result && (
              <Card className="border-border">
                <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-border">
                  <span className="text-xs text-muted-foreground font-medium">
                    פרק {currentChapter + 1}: {chapters[currentChapter]?.title}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
                    <Copy className="w-3.5 h-3.5" />
                    העתק
                  </Button>
                </div>
                <CardContent className="p-4">
                  <div className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap" style={{ fontSize: "12pt", textAlign: "justify", lineHeight: 1.8 }}>
                    <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
                  </div>
                  {result.footnotes.length > 0 && (
                    <div className="border-t border-border pt-4 mt-6 space-y-2">
                      <h3 className="font-semibold text-muted-foreground" style={{ fontSize: "11pt" }}>הערות שוליים</h3>
                      <ol className="space-y-1.5">
                        {result.footnotes.map((fn) => {
                          const badge = getSourceBadge(fn.source);
                          return (
                            <li key={fn.number} id={`legalqa-footnote-${fn.number}`} className="flex gap-2 items-start text-foreground" style={{ fontSize: "10pt" }}>
                              <span className="text-primary font-bold shrink-0 flex items-center gap-1" style={{ fontSize: "10pt" }}>
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: badge.color }} title={badge.label} />
                                {fn.number}.
                              </span>
                              <div className="min-w-0"><RenderBold text={fn.citation} /></div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </CardContent>
                {/* Feedback textbox for rewrite */}
                <div className="px-4 pb-2 space-y-2">
                  <textarea
                    value={chapterFeedback}
                    onChange={(e) => setChapterFeedback(e.target.value)}
                    placeholder="הנחיות נוספות לשכתוב (למשל: הרחב את סקירת הפסיקה, התמקד בגישה הביקורתית...)"
                    className="w-full rounded-lg border border-border bg-background p-2.5 text-xs min-h-[48px] resize-none"
                    dir="rtl"
                  />
                  {chapterFeedback.trim() && (
                    <Button variant="secondary" size="sm" onClick={rewriteWithFeedback} className="text-xs gap-1">
                      שכתב עם הנחיות
                    </Button>
                  )}
                </div>

                <div className="px-4 pb-4 flex gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={advanceToNextChapter}>
                    {currentChapter < chapters.length - 1 ? "המשך לפרק הבא" : "סיים עבודה"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={editCurrentChapter}>
                    כתוב מחדש פרק זה
                  </Button>
                </div>
              </Card>
            )}

            {/* DONE: show summary */}
            {wizardStep === "done" && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-6 text-center space-y-4">
                  <GraduationCap className="w-10 h-10 text-primary mx-auto" />
                  <h2 className="text-foreground text-lg font-bold">העבודה הושלמה!</h2>
                  <p className="text-sm text-muted-foreground">
                    {chapters.filter(ch => ch.content).length} פרקים נכתבו בהצלחה.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button onClick={handleCopy} className="gap-1.5">
                      <Copy className="w-4 h-4" />
                      העתק את כל העבודה
                    </Button>
                    <Button variant="outline" onClick={discardAcademicSession}>
                      עבודה חדשה
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Discard button when in progress */}
            {wizardStep !== "init" && wizardStep !== "done" && !loading && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="text-xs text-destructive gap-1" onClick={discardAcademicSession}>
                  <Trash2 className="w-3 h-3" />
                  בטל עבודה
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Non-academic empty state ── */}
        {!isAcademic && !result && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="text-4xl mb-3">⚖️</div>
            <h2 className="text-foreground text-lg font-bold mb-2">העוזר המשפטי</h2>
            <p className="text-muted-foreground text-sm">
              {uploadedFiles.length > 0
                ? "שאלו שאלה על המסמכים שהועלו – התשובה תתבסס על תוכן הקבצים ועל המאגר הפנימי"
                : "\n"}
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
                onClick={() => { setError(null); }}
                className="gap-1.5"
              >
                נסו שוב
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading skeleton */}
        {loading && taskMode !== "case_summary" && (
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

        {/* Case-summary refusal card */}
        {!isAcademic && result?.refusal && (
          <Alert className="mt-4 border-amber-500/40 bg-amber-50/40 dark:bg-amber-900/10">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-foreground space-y-3">
              <p className="text-sm leading-relaxed">{result.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                העלה קובץ פסק הדין
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Case-summary structured report */}
        {!isAcademic && result && !result.refusal && (result.case_summary || taskMode === "case_summary") && (
          <CaseSummaryReport
            answer={result.answer}
            metadata={result.case_metadata}
            verifiedSource={result.verified_source}
            onClear={() => { setResult(null); setQuestion(""); }}
          />
        )}

        {/* Verifying-source progress (case_summary only) */}
        {!isAcademic && loading && taskMode === "case_summary" && (
          <Card className="mt-4 border-primary/30">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-semibold text-foreground">מאמת מקור...</span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1.5 pr-6">
                <li>• בדיקת קלט המשתמש</li>
                <li>• חיפוש במאגר המקומי</li>
                <li>• איתור טקסט מלא חיצוני</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Non-academic result */}
        {!isAcademic && result && !result.refusal && !result.case_summary && taskMode !== "case_summary" && (
          <Card className="mt-4 border-border">
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
              <div
                className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap"
                style={{ fontSize: "12pt", textAlign: "justify", lineHeight: 1.8 }}
              >
                <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
              </div>

              {result.footnotes.length > 0 && (
                <div className="border-t border-border pt-4 mt-6 space-y-2">
                  <h3 className="font-semibold text-muted-foreground" style={{ fontSize: "11pt" }}>
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
                          style={{ fontSize: "10pt" }}
                        >
                          <span className="text-primary font-bold shrink-0 flex items-center gap-1" style={{ fontSize: "10pt" }}>
                            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: badge.color }} title={badge.label} />
                            {fn.number}.
                          </span>
                          <div className="min-w-0">
                            <RenderBold text={fn.citation} />
                            {fn.source === "document" && (
                              <span className="text-[9px] text-accent-foreground mr-1">[מתוך הקובץ שהועלה]</span>
                            )}
                            {fn.url && (
                              <a href={fn.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 mr-1.5" style={{ fontSize: "9pt" }}>
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

      {/* Bottom: Input bar pinned */}
      <div className="mt-auto px-2 sm:px-4 pb-2 pt-2 space-y-1.5 border-t border-border bg-background">
        {/* Hide input bar for academic mode (it has its own UI) unless in non-wizard steps */}
        {!isAcademic && (
          <div className="flex gap-2 items-end">
            {/* File upload zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
                uploadedFiles.length > 0
                  ? isFileRelevantMode
                    ? "border-primary/40 bg-primary/5"
                    : "border-amber-400/60 bg-amber-50/30 dark:bg-amber-900/10"
                  : "border-border hover:border-primary/30 hover:bg-muted/50"
              }`}
            >
              {extracting ? (
                <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              ) : uploadedFiles.length > 0 ? (
                <div className="relative flex items-center justify-center w-full h-full">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">
                    {uploadedFiles.length}
                  </span>
                </div>
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleFileSelect(e.target.files);
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
                placeholder={uploadedFiles.length > 0 ? `שאלו על ${uploadedFiles.length} קבצים...` : activeMode.placeholder}
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans resize-none"
                dir="rtl"
              />
              {loading ? (
                <button
                  onClick={handleStop}
                  className="btn-send px-4 py-2.5 m-1.5 text-destructive-foreground bg-destructive text-base flex-shrink-0 hover:bg-destructive/90"
                  title="עצור"
                >
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={question.trim().length < 5}
                  className="btn-send px-4 py-2.5 m-1.5 text-primary-foreground text-base flex-shrink-0 disabled:text-muted-foreground"
                >
                  ⇧
                </button>
              )}
            </div>
          </div>
        )}

        {/* Academic mode: file upload bar */}
        {isAcademic && wizardStep !== "done" && (
          <div className="flex gap-2 items-center">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 h-10 px-3 rounded-lg border border-dashed border-border hover:border-primary/30 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">העלאת קבצים</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleFileSelect(e.target.files);
                }}
              />
            </div>
            {loading && (
              <button
                onClick={handleStop}
                className="h-10 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs flex items-center gap-1.5"
              >
                <StopCircle className="w-3.5 h-3.5" />
                עצור
              </button>
            )}
          </div>
        )}

        {/* File list */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {uploadedFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                📎 {f.name}
                <button onClick={() => removeFile(i)} className="text-destructive hover:text-destructive/80">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Attribution */}
        <div className="text-center py-1 text-[10px] sm:text-[11px] text-muted-foreground">
          ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
        </div>
      </div>
    </div>
  );
}
