import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { buildEnginePromptHint } from "@/lib/citationValidation";
import { FormattedCitation } from "./FormattedCitation";
import { VerifiedAutocomplete } from "./VerifiedAutocomplete";
import { useBibliography } from "@/hooks/useBibliography";
import { useProjects } from "@/hooks/useProjects";
import { useOffice } from "@/hooks/useOffice";
import { insertCitationAsFootnote } from "@/lib/wordInsertion";
import { toast } from "sonner";
import { copyPlainText } from "@/lib/clipboard";
import { ensureVerifiedSources } from "@/lib/verifiedSources";

interface FootnoteCell {
  id: number;
  input: string;
  output: string | null;
  status: "empty" | "loading" | "valid" | "warning" | "verified";
  warningMsg?: string;
  verifiedCitation?: string;
}

const createCell = (id: number): FootnoteCell => ({
  id,
  input: "",
  output: null,
  status: "empty",
});

interface BatchProps {}

const CELLS_STORAGE_PREFIX = "footnote_cells";
const SUMMARY_STORAGE_PREFIX = "footnote_summary";

function getCellsKey(projectId: string | undefined) {
  return projectId ? `${CELLS_STORAGE_PREFIX}_${projectId}` : CELLS_STORAGE_PREFIX;
}
function getSummaryKey(projectId: string | undefined) {
  return projectId ? `${SUMMARY_STORAGE_PREFIX}_${projectId}` : SUMMARY_STORAGE_PREFIX;
}

function loadCells(projectId: string | undefined): FootnoteCell[] {
  try {
    const raw = localStorage.getItem(getCellsKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as FootnoteCell[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(c => ({ ...c, status: c.status === "loading" ? "empty" : c.status }));
    }
  } catch {}
  return Array.from({ length: 5 }, (_, i) => createCell(i + 1));
}

export function BatchFootnoteBuilder({}: BatchProps) {
  const { currentProject } = useProjects();
  const { isOfficeAddin, hasDocumentAccess } = useOffice();
  const projectId = currentProject?.id;
  const [cells, setCells] = useState<FootnoteCell[]>(() => loadCells(projectId));
  const [globalLoading, setGlobalLoading] = useState(false);
  const [isInsertingAll, setIsInsertingAll] = useState(false);
  const [insertingCellId, setInsertingCellId] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(() => localStorage.getItem(getSummaryKey(projectId)));
  const bibliography = useBibliography();

  // Reload when project changes
  useEffect(() => {
    setCells(loadCells(projectId));
    setSummary(localStorage.getItem(getSummaryKey(projectId)));
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(getCellsKey(projectId), JSON.stringify(cells));
  }, [cells, projectId]);

  useEffect(() => {
    const key = getSummaryKey(projectId);
    if (summary) localStorage.setItem(key, summary);
    else localStorage.removeItem(key);
  }, [summary, projectId]);

  const updateCellInput = useCallback((id: number, value: string) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, input: value, status: "empty", verifiedCitation: undefined } : c
      )
    );
  }, []);

  const setCellVerified = useCallback((id: number, citation: string) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, output: citation, status: "verified", verifiedCitation: citation } : c
      )
    );
  }, []);

  const addCell = useCallback(() => {
    setCells((prev) => [...prev, createCell(prev.length + 1)]);
  }, []);

  const removeCell = useCallback((id: number) => {
    setCells((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, id: i + 1 }));
    });
  }, []);

  // Drag and drop
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      setCells((prev) => {
        const reordered = [...prev];
        const [removed] = reordered.splice(dragItem.current!, 1);
        reordered.splice(dragOverItem.current!, 0, removed);
        return reordered.map((c, i) => ({ ...c, id: i + 1 }));
      });
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragIndex(null);
  }, []);

  const processAllCells = async () => {
    
    const activeCells = cells.filter((c) => c.input.trim() && c.status !== "verified");
    if (activeCells.length === 0) {
      toast.error("אנא הזן לפחות מקור אחד");
      return;
    }

    setGlobalLoading(true);
    setSummary(null);

    setCells((prev) =>
      prev.map((c) =>
        c.input.trim() && c.status !== "verified" ? { ...c, status: "loading", output: null } : c
      )
    );

    const sourcesText = activeCells
      .map((c) => {
        const normalized = normalizeAbbreviations(c.input);
        const sourceType = detectSourceType(normalized);
        const label = SOURCE_TYPE_LABELS[sourceType];
        return `הערה ${c.id}: ${label !== "לא ידוע" ? `[${label}] ` : ""}${normalized}`;
      })
      .join("\n");

    const prompt = `אנא ייצר הערות שוליים תקניות לפי כללי האזכור האחיד עבור המקורות הבאים. כל מקור בשורה נפרדת.

כללי אזכור חוזר (כלל 37.7) – חובה ליישם:
1. בהופעה הראשונה של מקור אסור להשתמש ב"שם" או ב"לעיל ה\"ש". בפעם הראשונה תמיד החזר אזכור מלא.
2. אם הערה N מכילה בדיוק את אותו מקור כמו הערה N-1, השתמש ב"שם." בלבד.
3. אם אותו מקור מופיע שוב אך עם הפניה פנימית אחרת באותו מקור (למשל סעיף/עמוד/פסקה אחרים), השתמש ב"שם, סעיף X" או "שם, בעמ' Y" לפי העניין.
4. אם מקור כבר הופיע בהערה מוקדמת יותר אך לא בהערה שמיד קודמת, השתמש ב"[שם מקור מקוצר], לעיל ה\"ש X"; ואם יש הפניה פנימית שונה הוסף אותה בסוף.
5. כדי לקבוע "אותו מקור", התעלם מהבדלים של סעיף/עמוד/פסקה.

חשוב מאוד נוסף:
- לכל הערה, ציין את מספר הכלל בסוף (📐 כלל: X.X).
- אם חסרים פרטים, סמן [חסר:...] והוסף אזהרה.
- אל תכלול משפטי פתיחה או הקדמה. החזר רק את ההערות עצמן.

המקורות:
${sourcesText}

אנא החזר את התוצאה בפורמט הבא בדיוק, כל הערה בשורה נפרדת, בלי שום טקסט לפני או אחרי:
---FOOTNOTE 1---
[אזכור תקני]
📐 כלל: [מספר]
---FOOTNOTE 2---
[אזכור תקני]
📐 כלל: [מספר]
...וכן הלאה`;

    try {
      const { data, error } = await supabase.functions.invoke("citation-chat", {
        body: { messages: [{ role: "user", content: prompt }] },
      });

      if (error) throw error;

      const content = data?.content || "";
      const footnotes = parseFootnotes(content, activeCells.length);

      let warningCount = 0;
      let validCount = 0;

      let nextCells: FootnoteCell[] = [];
      const updatedCells: FootnoteCell[] = [];
      setCells((prev) => {
        const drafted = prev.map((c) => {
          if (!c.input.trim() || c.status === "verified") return c;
          const idx = activeCells.findIndex((ac) => ac.id === c.id);
          if (idx === -1) return c;
          return {
            ...c,
            output: footnotes[idx] || content,
            status: "valid" as FootnoteCell["status"],
            warningMsg: undefined,
          };
        });

        const normalized = applyRepeatCitationRules(drafted);
        nextCells = normalized;

        for (const cell of normalized) {
          if (!cell.input.trim() || !activeCells.some((ac) => ac.id === cell.id)) continue;
          const hasWarning = Boolean(cell.output) && (/\[חסר:/.test(cell.output) || /⚠️/.test(cell.output));
          if (hasWarning) warningCount++;
          else validCount++;
          updatedCells.push({
            ...cell,
            status: (hasWarning ? "warning" : cell.status === "verified" ? "verified" : "valid") as FootnoteCell["status"],
            warningMsg: hasWarning ? "חסרים פרטים – ראה סימון בתוצאה" : undefined,
          });
        }

        return normalized.map((cell) => {
          if (!activeCells.some((ac) => ac.id === cell.id)) return cell;
          const finalCell = updatedCells.find((updated) => updated.id === cell.id);
          return finalCell || cell;
        });
      });

      // Save to citation history and persist verified sources
      const verifiedCandidates: { rawInput: string; fullCitation: string; sourceType: string | null }[] = [];

      for (const cell of updatedCells) {
        if (!cell.output) continue;

        const sourceType = detectSourceType(normalizeAbbreviations(cell.input));
        const label = SOURCE_TYPE_LABELS[sourceType];
        const fullCitation = extractCitationOnly(cell.output);
        const isVerified = cell.status === "valid" && !/\[חסר:/.test(cell.output);

        supabase.from("citation_history").insert({
          raw_input: cell.input,
          formatted_output: fullCitation,
          source_type: label !== "לא ידוע" ? label : null,
          is_verified: isVerified,
        }).then(() => {});

        if (isVerified) {
          verifiedCandidates.push({
            rawInput: cell.input,
            fullCitation,
            sourceType: label !== "לא ידוע" ? label : null,
          });
        }
      }

      if (verifiedCandidates.length > 0) {
        ensureVerifiedSources(verifiedCandidates).catch(() => {});
      }

      // Recalculate bibliography from all current outputs instead of pushing into it
      const bibItems = nextCells
        .filter((cell) => {
          if (!cell.output) return false;
          const cleaned = extractCitationOnly(cell.output);
          if (/^שם[.,\s]|^שם$/.test(cleaned.trim())) return false;
          if (/לעיל ה"ש/.test(cleaned)) return false;
          return true;
        })
        .map((cell) => ({
          rawInput: cell.input,
          fullCitation: extractCitationOnly(cell.output!),
        }));

      const syncedCount = bibliography.syncFootnoteEntries(bibItems);
      if (syncedCount > 0) {
        toast(`${syncedCount} מקורות חושבו מחדש בביבליוגרפיה`, {
          duration: 3000,
          icon: "📚",
        });
      }

      const total = validCount + warningCount;
      
      const repeatNote = /שם|לעיל/.test(content)
        ? " שים לב לתיקונים בנסיבות של אזכור חוזר."
        : "";
      setSummary(
        `בניתי עבורך ${total} הערות שוליים לפי הכללים.${
          warningCount > 0 ? ` ${warningCount} הערות דורשות השלמת פרטים.` : ""
        }${repeatNote}`
      );
    } catch {
      setCells((prev) =>
        prev.map((c) =>
          c.status === "loading" ? { ...c, status: "empty", output: null } : c
        )
      );
      toast.error("שגיאה בחיבור לשרת");
    } finally {
      setGlobalLoading(false);
    }
  };

  const copyAll = () => {
    const outputs = cells
      .filter((c) => c.output)
      .map((c) => {
        const citation = extractCitationOnly(c.output!);
        return `[${c.id}] ${citation}`;
      })
      .join("\n\n");

    if (!outputs) {
      toast.error("אין הערות שוליים להעתקה");
      return;
    }
    copyPlainText(outputs);
    toast.success("כל הערות השוליים הועתקו ללוח!");
  };

  const copySingle = (cell: FootnoteCell) => {
    if (!cell.output) return;
    const citation = extractCitationOnly(cell.output);
    copyPlainText(citation);
    toast.success(`הערה ${cell.id} הועתקה!`);
  };

  const resetAll = () => {
    setCells(Array.from({ length: 5 }, (_, i) => createCell(i + 1)));
    setSummary(null);
    localStorage.removeItem(getCellsKey(projectId));
    localStorage.removeItem(getSummaryKey(projectId));
  };

  const hasAnyOutput = cells.some((c) => c.output);
  const hasAnyInput = cells.some((c) => c.input.trim());
  const outputCells = cells.filter((c) => c.output);

  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground text-lg font-bold font-sans">
            בניית הערות שוליים
          </h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            הזן מקורות והמערכת תייצר הערות שוליים מוכנות ל-Word
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAnyInput && (
            <button
              onClick={resetAll}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1.5 rounded-lg transition-colors"
            >
              🗑 נקה
            </button>
          )}
        </div>
      </div>

      {/* === INPUT SECTION === */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
        <div className="space-y-2.5">
          {cells.map((cell, index) => (
            <div
              key={`cell-${index}`}
              draggable={!globalLoading}
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={`flex items-start gap-2 transition-opacity ${
                dragIndex === index ? "opacity-40" : ""
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1.5 cursor-grab active:cursor-grabbing ${
                  cell.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"
                }`}
                title="גרור לשינוי סדר"
              >
                {cell.status === "verified" ? "✓" : cell.id}
              </div>
              <VerifiedAutocomplete
                value={cell.input}
                onChange={(v) => updateCellInput(cell.id, v)}
                onSelectCitation={(citation) => setCellVerified(cell.id, citation)}
                placeholder="הזן מקור (פסיקה, חקיקה, ספרות...)"
                disabled={globalLoading}
              />
              {cells.length > 1 && (
                <button
                  onClick={() => removeCell(cell.id)}
                  className="text-[11px] text-muted-foreground hover:text-destructive px-1.5 py-2 rounded transition-colors flex-shrink-0 mt-0.5"
                  title="הסר"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addCell}
          disabled={globalLoading}
          className="mt-3 w-full py-2 border-2 border-dashed border-border hover:border-primary/40 rounded-lg text-muted-foreground hover:text-primary transition-all text-sm font-medium disabled:opacity-40"
        >
          + הוסף מקור
        </button>
      </div>

      {/* Generate Button */}
      <button
        onClick={processAllCells}
        disabled={globalLoading || !hasAnyInput}
        className="mt-4 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: globalLoading || !hasAnyInput ? "hsl(var(--muted))" : "var(--gradient-primary)",
          color: globalLoading || !hasAnyInput ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
        }}
      >
        {globalLoading ? "מעבד הערות שוליים..." : "⚖ ייצר הערות שוליים"}
      </button>

      {/* === OUTPUT SECTION === */}
      {(hasAnyOutput || globalLoading) && (
        <div className="mt-5 bg-card border border-border rounded-xl shadow-sm animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h4 className="text-foreground text-sm font-bold font-sans">
              📄 הערות שוליים
            </h4>
            {hasAnyOutput && (
              <div className="flex items-center gap-2">
                {isOfficeAddin && (
                  <button
                    onClick={async () => {
                      setIsInsertingAll(true);
                      let inserted = 0;
                      let copied = 0;
                      for (const cell of outputCells) {
                        if (cell.output) {
                          const result = await insertCitationAsFootnote(cell.output);
                          if (result.mode === "manual-copy") {
                            copied++;
                          } else {
                            inserted++;
                          }
                        }
                      }
                      setIsInsertingAll(false);
                      if (inserted > 0) {
                        toast.success(`הוכנסו ${inserted} הערות שוליים ל-Word`);
                      }
                      if (copied > 0) {
                        toast.info(`${copied} הערות הועתקו ללוח — הדבק/י ב-Word ידנית (Ctrl+V)`, { duration: 6000 });
                      }
                    }}
                    disabled={isInsertingAll || !hasDocumentAccess}
                    className="text-xs bg-secondary/10 text-secondary hover:bg-secondary/20 border border-secondary/30 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-50"
                    title={!hasDocumentAccess ? "ממתין לחיבור ל-Word..." : ""}
                  >
                    {isInsertingAll ? "⏳ מכניס..." : !hasDocumentAccess ? "⏳ מתחבר ל-Word..." : "📝 הכנס הכל ל-Word"}
                  </button>
                )}
                <button
                  onClick={copyAll}
                  className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  📋 העתק הכל
                </button>
              </div>
            )}
          </div>

          <div className="p-4 space-y-3">
            {globalLoading && !hasAnyOutput && (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span>מעבד הערות שוליים...</span>
              </div>
            )}

            {outputCells.map((cell) => (
              <div
                key={cell.id}
                className="flex items-start gap-3 group"
              >
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  <span className="text-primary font-bold text-sm font-sans">[{cell.id}]</span>
                  {cell.status === "verified" && (
                    <span className="text-emerald-600 text-xs" title="מקור מאומת">✓</span>
                  )}
                  {cell.status === "warning" && (
                    <span className="text-destructive text-xs" title={cell.warningMsg}>⚠</span>
                  )}
                </div>
                <div className="flex-1 text-foreground text-sm leading-relaxed">
                  <FormattedCitation text={cell.output!} enableTooltips />
                </div>
                {isOfficeAddin && (
                  <button
                    onClick={async () => {
                      setInsertingCellId(cell.id);
                      const result = await insertCitationAsFootnote(cell.output!);
                      if (result.mode === "manual-copy") {
                        toast.info("הועתק ללוח — הדבק/י ב-Word ידנית (Ctrl+V)", { duration: 5000 });
                      } else {
                        toast.success(result.mode === "footnote" ? "הוכנס כהערת שוליים!" : "הוכנס כטקסט!");
                      }
                      setInsertingCellId(null);
                    }}
                    disabled={insertingCellId === cell.id || !hasDocumentAccess}
                    className="text-[11px] text-secondary hover:bg-secondary/10 px-2 py-1 rounded transition-colors flex-shrink-0 disabled:opacity-50"
                    title={!hasDocumentAccess ? "ממתין לחיבור ל-Word..." : "הכנס ל-Word"}
                  >
                    {insertingCellId === cell.id ? "⏳" : !hasDocumentAccess ? "⏳" : "📝"}
                  </button>
                )}
                <button
                  onClick={() => copySingle(cell)}
                  className="text-[11px] text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  📋
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="mt-4 bg-primary/5 border border-primary/15 rounded-xl p-3 text-sm text-foreground animate-fade-in">
          <div className="flex items-start gap-2">
            <span className="text-lg">🏛</span>
            <div>
              <p className="font-semibold text-primary text-xs mb-0.5">
                העוזר המשפטי האוטומטי
              </p>
              <p className="text-foreground/80">{summary}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseFootnotes(content: string, expectedCount: number): string[] {
  const parts = content.split(/---FOOTNOTE\s*\d+---/i).filter((s) => s.trim());
  if (parts.length >= expectedCount) {
    return parts.slice(0, expectedCount).map((p) => p.trim());
  }

  const lines = content.split("\n");
  const footnotes: string[] = [];
  let current = "";
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+/);
    if (match && parseInt(match[1]) === footnotes.length + 1) {
      if (current) footnotes.push(current.trim());
      current = line;
    } else {
      current += "\n" + line;
    }
  }
  if (current) footnotes.push(current.trim());

  if (footnotes.length >= expectedCount) return footnotes.slice(0, expectedCount);

  return Array(expectedCount).fill(content);
}

function applyRepeatCitationRules(cells: FootnoteCell[]): FootnoteCell[] {
  const seen = new Map<string, { index: number; fullCitation: string }>();

  return cells.map((cell, index) => {
    if (!cell.output) return cell;

    const citationOnly = extractCitationOnly(cell.output);
    const sourceKey = normalizeSourceKey(cell.input || citationOnly);
    if (!sourceKey) return cell;

    const prior = seen.get(sourceKey);
    const normalizedOutput = citationOnly.trim();

    if (!prior) {
      seen.set(sourceKey, { index: index + 1, fullCitation: normalizedOutput });
      return cell;
    }

    const referenceSuffix = extractReferenceSuffix(cell.input);
    const isImmediateRepeat = prior.index === index;
    const nextCitation = isImmediateRepeat
      ? `שם${referenceSuffix ? `, ${referenceSuffix}` : "."}`
      : `${extractShortSourceLabel(prior.fullCitation)}, לעיל ה"ש ${prior.index}${referenceSuffix ? `, ${referenceSuffix}` : ""}.`;

    return {
      ...cell,
      output: replaceCitationOnly(cell.output, nextCitation),
    };
  });
}

function normalizeSourceKey(text: string): string {
  return text
    .trim()
    .replace(/^הערה\s*\d+:\s*/i, "")
    .replace(/^סעיף\s+[\dא-ת()./\-–]+\s+ל/, "")
    .replace(/^section\s+[A-Za-z0-9()./\-–]+\s+of\s+/i, "")
    .replace(/\bבעמ['״]?\s*[\d\-–]+/g, "")
    .replace(/\bעמ['״]?\s*[\d\-–]+/g, "")
    .replace(/\bפסקה\s*\d+/g, "")
    .replace(/\bpara\.?\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractReferenceSuffix(text: string): string {
  const trimmed = text.trim();
  const hebrewSection = trimmed.match(/סעיף\s+[\dא-ת()./\-–]+/);
  if (hebrewSection) return hebrewSection[0];
  const hebrewPage = trimmed.match(/בעמ['״]?\s*[\d\-–]+|עמ['״]?\s*[\d\-–]+/);
  if (hebrewPage) return hebrewPage[0];
  const hebrewParagraph = trimmed.match(/פסקה\s*\d+/);
  if (hebrewParagraph) return hebrewParagraph[0];
  const englishSection = trimmed.match(/section\s+[A-Za-z0-9()./\-–]+/i);
  if (englishSection) return englishSection[0];
  const englishPage = trimmed.match(/at\s+\d+(?:[\-–]\d+)?/i);
  if (englishPage) return englishPage[0];
  const englishParagraph = trimmed.match(/para\.?\s*\d+/i);
  if (englishParagraph) return englishParagraph[0];
  return "";
}

function extractShortSourceLabel(text: string): string {
  const cleaned = text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .trim();

  const caseMatch = cleaned.match(/\*\*?([^*\n]+?)\*\*?\s+נ['׳]/);
  if (caseMatch) return caseMatch[1].trim();

  const hebrewLaw = cleaned.match(/(חוק[\s-]יסוד[^,\n]*|חוק[^,\n]*|פקודת[^,\n]*|פקודה[^,\n]*|תקנות[^,\n]*|צו[^,\n]*)/);
  if (hebrewLaw) return hebrewLaw[1].trim();

  const englishLead = cleaned.match(/^([^,(\n]{3,80})/);
  if (englishLead) return englishLead[1].trim();

  return cleaned.split(",")[0].trim();
}

function replaceCitationOnly(fullText: string, nextCitation: string): string {
  const lines = fullText.split("\n");
  const ruleLines = lines.filter((line) => /^📐|^כלל:/.test(line.trim()));
  const warningLines = lines.filter((line) => /^⚠️|\[חסר:|המערכת זיהתה/.test(line.trim()));
  return [nextCitation, ...ruleLines, ...warningLines].filter(Boolean).join("\n");
}

function extractCitationOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(trimmed)) return false;
      if (/העוזר המשפטי/.test(trimmed)) return false;
      if (/יתחיל בעיבוד|אתחיל בעיבוד|אטפל בבקשתך/.test(trimmed)) return false;
      if (/^שלב \d|^זיהוי סוג|^נרמול|^יישום/.test(trimmed)) return false;
      if (/^---FOOTNOTE/i.test(trimmed)) return false;
      if (/\[חסר:/.test(trimmed) || /המערכת זיהתה/.test(trimmed)) return true;
      return true;
    })
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}
