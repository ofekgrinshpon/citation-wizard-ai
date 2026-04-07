import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBibliography, CATEGORY_LABELS, sortBibliography } from "@/hooks/useBibliography";
import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";

export function BibliographyGenerator() {
  const { sortedEntries, addEntries, removeEntry, clearAll } = useBibliography();
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);

  const processRawList = async () => {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("אנא הזן מקורות לעיבוד");
      return;
    }

    setLoading(true);
    try {
      const prompt = `אתה מומחה לכללי האזכור האחיד (מהדורה שלישית 2021).
קיבלת רשימת מקורות גולמיים. עבור כל מקור, החזר את האזכור התקני המלא (לא קיצור, לא "שם", לא "לעיל") – כולל שנה, כרך, צדדים מלאים.

המקורות:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

החזר בפורמט הבא בדיוק, בלי שום טקסט נוסף:
---BIB 1---
[אזכור מלא]
---BIB 2---
[אזכור מלא]
...וכן הלאה`;

      const { data, error } = await supabase.functions.invoke("citation-chat", {
        body: { messages: [{ role: "user", content: prompt }] },
      });

      if (error) throw error;

      const content = data?.content || "";
      const parts = content.split(/---BIB\s*\d+---/i).filter((s: string) => s.trim());

      const items = lines.map((line, i) => ({
        rawInput: line,
        fullCitation: cleanCitation(parts[i] || line),
      }));

      const added = addEntries(items);
      toast.success(`${added} מקורות נוספו לביבליוגרפיה (${lines.length - added} כפילויות הוסרו)`);
      setRawText("");
    } catch {
      toast.error("שגיאה בעיבוד הרשימה");
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (sortedEntries.length === 0) {
      toast.error("אין מקורות בביבליוגרפיה");
      return;
    }

    // Group by language then category
    const grouped = groupEntries(sortedEntries);
    const lines: string[] = [];

    // Hebrew sources
    const hebrewCats = grouped.filter((g) => g.language === "hebrew");
    if (hebrewCats.length > 0) {
      lines.push("מקורות בעברית");
      lines.push("");
      for (const group of hebrewCats) {
        lines.push(CATEGORY_LABELS[group.category] || group.category);
        for (const entry of group.entries) {
          lines.push(cleanForCopy(entry.fullCitation));
        }
        lines.push("");
      }
    }

    // English sources
    const englishCats = grouped.filter((g) => g.language === "english");
    if (englishCats.length > 0) {
      lines.push("מקורות באנגלית");
      lines.push("");
      for (const group of englishCats) {
        lines.push(CATEGORY_LABELS[group.category] || group.category);
        for (const entry of group.entries) {
          lines.push(cleanForCopy(entry.fullCitation));
        }
        lines.push("");
      }
    }

    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("הביבליוגרפיה הועתקה ללוח!");
  };

  const grouped = groupEntries(sortedEntries);
  const hebrewGroups = grouped.filter((g) => g.language === "hebrew");
  const englishGroups = grouped.filter((g) => g.language === "english");

  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground text-lg font-bold font-sans">מחולל ביבליוגרפיה</h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
          </p>
        </div>
        {sortedEntries.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
              {sortedEntries.length} מקורות
            </span>
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1.5 rounded-lg transition-colors"
            >
              🗑 נקה
            </button>
          </div>
        )}
      </div>

      {/* Manual input area */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm mb-4">
        <label className="text-sm font-semibold text-foreground mb-2 block">
          הזנה ידנית – הדבק מקורות (כל מקור בשורה נפרדת)
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`למשל:\nע"א 6821/93 בנק המזרחי נ' מגדל, פ"ד מט(4) 221 (1995)\nחוק-יסוד: כבוד האדם וחירותו\nAharon Barak, Proportionality (2012)`}
          className="w-full min-h-[120px] bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/60 transition-all resize-none"
          disabled={loading}
        />
        <button
          onClick={processRawList}
          disabled={loading || !rawText.trim()}
          className="mt-3 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: loading || !rawText.trim() ? "hsl(var(--muted))" : "var(--gradient-primary)",
            color: loading || !rawText.trim() ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
          }}
        >
          {loading ? "מעבד רשימה..." : "📚 עבד רשימה"}
        </button>
      </div>

      {/* Bibliography output */}
      {sortedEntries.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h4 className="text-foreground text-sm font-bold font-sans">📖 ביבליוגרפיה מסודרת</h4>
            <button
              onClick={copyAll}
              className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              📋 העתק הכל ל-Word
            </button>
          </div>

          <div className="p-4">
            {/* Hebrew sources */}
            {hebrewGroups.length > 0 && (
              <div className="mb-4">
                <h5 className="text-primary font-bold text-sm mb-3 pb-1 border-b border-primary/20">
                  מקורות בעברית
                </h5>
                {hebrewGroups.map((group) => (
                  <CategoryGroup
                    key={group.category}
                    label={CATEGORY_LABELS[group.category] || group.category}
                    entries={group.entries}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            )}

            {/* English sources */}
            {englishGroups.length > 0 && (
              <div>
                <h5 className="text-primary font-bold text-sm mb-3 pb-1 border-b border-primary/20">
                  מקורות באנגלית
                </h5>
                {englishGroups.map((group) => (
                  <CategoryGroup
                    key={group.category}
                    label={CATEGORY_LABELS[group.category] || group.category}
                    entries={group.entries}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sortedEntries.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📚</div>
          <p className="text-muted-foreground text-sm">
            הביבליוגרפיה ריקה. הזן מקורות למעלה או ייצר הערות שוליים – המקורות יתווספו אוטומטית.
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  label,
  entries,
  onRemove,
}: {
  label: string;
  entries: { id: string; fullCitation: string; addedFrom: string }[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <h6 className="text-foreground text-xs font-bold mb-1.5 mr-1">{label}</h6>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 group">
            <div className="flex-1 text-foreground text-sm leading-relaxed pr-2">
              <FormattedCitation text={entry.fullCitation} enableTooltips />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {entry.addedFrom === "footnote" && (
                <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  מה"ש
                </span>
              )}
              <button
                onClick={() => onRemove(entry.id)}
                className="text-[11px] text-muted-foreground hover:text-destructive px-1 py-0.5 rounded transition-colors"
                title="הסר"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GroupedCategory {
  category: string;
  language: "hebrew" | "english";
  entries: { id: string; fullCitation: string; addedFrom: string }[];
}

function groupEntries(sorted: { id: string; fullCitation: string; sourceType: string; language: string; addedFrom: string }[]): GroupedCategory[] {
  const groups: GroupedCategory[] = [];
  let currentKey = "";

  for (const entry of sorted) {
    const key = `${entry.language}:${entry.sourceType}`;
    if (key !== currentKey) {
      groups.push({
        category: entry.sourceType,
        language: entry.language as "hebrew" | "english",
        entries: [],
      });
      currentKey = key;
    }
    groups[groups.length - 1].entries.push(entry);
  }

  return groups;
}

function cleanCitation(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^📐.*$/gm, "")
    .replace(/^כלל:.*$/gm, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function cleanForCopy(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^📐.*$/gm, "")
    .trim();
}
