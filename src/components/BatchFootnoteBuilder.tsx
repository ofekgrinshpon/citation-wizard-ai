import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS } from "@/data/abbreviations";
import { FormattedCitation } from "./FormattedCitation";
import { VerifiedAutocomplete } from "./VerifiedAutocomplete";
import { toast } from "sonner";

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

export function BatchFootnoteBuilder() {
  const [cells, setCells] = useState<FootnoteCell[]>(
    Array.from({ length: 5 }, (_, i) => createCell(i + 1))
  );
  const [globalLoading, setGlobalLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

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

חשוב מאוד:
- אם מקור חוזר על עצמו (אותו מקור בהערה אחרת), השתמש בכלל 37.7 – "שם" או "לעיל ה"ש X" בהתאם.
- אם מקור דומה אך עם עמוד שונה, השתמש ב"שם, בעמ' Y".
- לכל הערה, ציין את מספר הכלל בסוף (📐 כלל: X.X).
- אם חסרים פרטים, סמן [חסר:...] והוסף אזהרה.
- אל תכלול משפטי פתיחה או הקדמה כמו "העוזר המשפטי האוטומטי יתחיל בעיבוד בקשתך" או כל טקסט מבוא. החזר רק את ההערות עצמן.

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

      const updatedCells: FootnoteCell[] = [];
      setCells((prev) => {
        const result = prev.map((c) => {
          if (!c.input.trim() || c.status === "verified") return c;
          const idx = activeCells.findIndex((ac) => ac.id === c.id);
          if (idx === -1) return c;
          const fn = footnotes[idx] || content;
          const hasWarning = /\[חסר:/.test(fn) || /⚠️/.test(fn);
          if (hasWarning) warningCount++;
          else validCount++;
          const updated = {
            ...c,
            output: fn,
            status: (hasWarning ? "warning" : "valid") as FootnoteCell["status"],
            warningMsg: hasWarning ? "חסרים פרטים – ראה סימון בתוצאה" : undefined,
          };
          updatedCells.push(updated);
          return updated;
        });
        return result;
      });

      // Save to citation history
      for (const cell of updatedCells) {
        if (cell.output) {
          const sourceType = detectSourceType(normalizeAbbreviations(cell.input));
          const label = SOURCE_TYPE_LABELS[sourceType];
          supabase.from("citation_history").insert({
            raw_input: cell.input,
            formatted_output: extractCitationOnly(cell.output),
            source_type: label !== "לא ידוע" ? label : null,
            is_verified: cell.status === "valid" && !/\[חסר:/.test(cell.output),
          }).then(() => {});
        }
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
    navigator.clipboard.writeText(outputs);
    toast.success("כל הערות השוליים הועתקו ללוח!");
  };

  const copySingle = (cell: FootnoteCell) => {
    if (!cell.output) return;
    const citation = extractCitationOnly(cell.output);
    navigator.clipboard.writeText(citation);
    toast.success(`הערה ${cell.id} הועתקה!`);
  };

  const resetAll = () => {
    setCells(Array.from({ length: 5 }, (_, i) => createCell(i + 1)));
    setSummary(null);
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
          {cells.map((cell) => (
            <div key={cell.id} className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1.5">
                {cell.id}
              </div>
              <textarea
                value={cell.input}
                onChange={(e) => updateCellInput(cell.id, e.target.value)}
                placeholder="הזן מקור (פסיקה, חקיקה, ספרות...)"
                rows={1}
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm font-sans resize-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
                style={{ direction: "rtl" }}
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
              <button
                onClick={copyAll}
                className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                📋 העתק הכל
              </button>
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
                  {cell.status === "warning" && (
                    <span className="text-destructive text-xs" title={cell.warningMsg}>⚠</span>
                  )}
                </div>
                <div className="flex-1 text-foreground text-sm leading-relaxed">
                  <FormattedCitation text={cell.output!} enableTooltips />
                </div>
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
