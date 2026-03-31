import { useState, useCallback, useEffect, createContext, useContext } from "react";

export interface BibliographyEntry {
  id: string;
  rawInput: string;
  fullCitation: string;
  sourceType: BibSourceCategory;
  language: "hebrew" | "english";
  subCategory: string;
  year?: number;
  authorSurname?: string;
  addedFrom: "footnote" | "manual";
  addedAt: number;
}

export type BibSourceCategory =
  | "legislation_primary"
  | "legislation_secondary"
  | "caselaw_supreme"
  | "caselaw_district"
  | "caselaw_magistrate"
  | "caselaw_specialized"
  | "literature"
  | "misc"
  | "unknown";

const CATEGORY_ORDER: Record<string, number> = {
  legislation_primary: 1,
  legislation_secondary: 2,
  caselaw_supreme: 3,
  caselaw_district: 4,
  caselaw_magistrate: 5,
  caselaw_specialized: 6,
  literature: 7,
  misc: 8,
  unknown: 9,
};

export const CATEGORY_LABELS: Record<string, string> = {
  legislation_primary: "חקיקה ראשית",
  legislation_secondary: "חקיקה משנית",
  caselaw_supreme: 'פסיקה – ביהמ"ש העליון',
  caselaw_district: "פסיקה – בית משפט מחוזי",
  caselaw_magistrate: "פסיקה – בית משפט שלום",
  caselaw_specialized: "פסיקה – בתי דין מיוחדים",
  literature: "ספרות משפטית",
  misc: "שונות",
  unknown: "אחר",
};

export function classifyCitation(text: string): {
  sourceType: BibSourceCategory;
  language: "hebrew" | "english";
  subCategory: string;
  year?: number;
  authorSurname?: string;
} {
  const isEnglish = /^[A-Za-z]/.test(text.trim()) || /\bv\.\b|\bvs\.\b/.test(text);
  const language = isEnglish ? "english" : "hebrew";

  // Extract year
  let year: number | undefined;
  const yearMatch = text.match(/\((\d{4})\)/) || text.match(/(\d{4})/);
  if (yearMatch) year = parseInt(yearMatch[1]);

  // Classify source type
  let sourceType: BibSourceCategory = "unknown";
  let subCategory = "";

  // Legislation
  if (/חוק[\s-]יסוד|חוק|פקודת|פקודה/.test(text)) {
    sourceType = "legislation_primary";
    subCategory = /חוק[\s-]יסוד/.test(text) ? "חוק יסוד" : "חוק/פקודה";
  } else if (/תקנות|צו|נוהל|הוראת/.test(text)) {
    sourceType = "legislation_secondary";
    subCategory = "תקנות/צו";
  }
  // Case law
  else if (/בג"ץ|ע"א|רע"א|דנ"א|ע"פ|רע"פ|דנ"פ|ע"ע|עש"מ|בש"פ/.test(text) || /Supreme Court|S\.Ct\./.test(text)) {
    sourceType = "caselaw_supreme";
    subCategory = "בית המשפט העליון";
  } else if (/ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק/.test(text) || /District Court|Circuit/.test(text)) {
    sourceType = "caselaw_district";
    subCategory = "בית משפט מחוזי";
  } else if (/ת"ט|תא"מ|ת"ד/.test(text) || /Magistrate/.test(text)) {
    sourceType = "caselaw_magistrate";
    subCategory = "בית משפט שלום";
  } else if (/עב"ל|ס"ק|ד"מ|בית[\s]הדין/.test(text) || /Tribunal/.test(text)) {
    sourceType = "caselaw_specialized";
    subCategory = "בית דין מיוחד";
  }
  // Case law by general patterns  
  else if (/נ['׳]\s|נגד\s|\bv\.\b|\bvs\.\b/.test(text) || /פד"י|פ"ד|דינים/.test(text)) {
    sourceType = "caselaw_supreme";
    subCategory = "פסיקה";
  }
  // Literature
  else if (/מאמר|ספר|עיוני משפט|משפטים|הפרקליט|מחקרי משפט/.test(text) || /\bJ\.\b|\bL\.\s*Rev\b|\bBook\b/i.test(text)) {
    sourceType = "literature";
    subCategory = "ספרות";
  }
  // Misc
  else if (/https?:\/\/|אתר|רשתת/.test(text)) {
    sourceType = "misc";
    subCategory = "מקורות מרשתת";
  }

  // Extract author surname for literature sorting
  let authorSurname: string | undefined;
  if (sourceType === "literature") {
    // Try to get first word as surname for Hebrew, or last word before comma for English
    if (isEnglish) {
      const match = text.match(/^([A-Za-z]+)/);
      if (match) authorSurname = match[1];
    } else {
      const match = text.match(/^([^\s,]+)/);
      if (match) authorSurname = match[1];
    }
  }

  return { sourceType, language, subCategory, year, authorSurname };
}

export function sortBibliography(entries: BibliographyEntry[]): BibliographyEntry[] {
  return [...entries].sort((a, b) => {
    // Hebrew first, then English
    if (a.language !== b.language) {
      return a.language === "hebrew" ? -1 : 1;
    }
    // By category order
    const catA = CATEGORY_ORDER[a.sourceType] || 99;
    const catB = CATEGORY_ORDER[b.sourceType] || 99;
    if (catA !== catB) return catA - catB;

    // Literature: alphabetical by author surname
    if (a.sourceType === "literature" && b.sourceType === "literature") {
      return (a.authorSurname || "").localeCompare(b.authorSurname || "", "he");
    }
    // Everything else: chronological
    return (a.year || 9999) - (b.year || 9999);
  });
}

interface BibliographyContextValue {
  entries: BibliographyEntry[];
  addEntry: (rawInput: string, fullCitation: string, from: "footnote" | "manual") => boolean;
  addEntries: (items: { rawInput: string; fullCitation: string }[]) => number;
  removeEntry: (id: string) => void;
  clearAll: () => void;
  sortedEntries: BibliographyEntry[];
}

const BibliographyContext = createContext<BibliographyContextValue | null>(null);

const BIB_STORAGE_KEY = "bibliography_entries";

function loadBibEntries(): BibliographyEntry[] {
  try {
    const raw = localStorage.getItem(BIB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function BibliographyProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<BibliographyEntry[]>(loadBibEntries);

  const isDuplicate = useCallback(
    (fullCitation: string, current: BibliographyEntry[]) => {
      const normalized = fullCitation.replace(/\s+/g, " ").trim().toLowerCase();
      return current.some(
        (e) => e.fullCitation.replace(/\s+/g, " ").trim().toLowerCase() === normalized
      );
    },
    []
  );

  const addEntry = useCallback(
    (rawInput: string, fullCitation: string, from: "footnote" | "manual"): boolean => {
      let added = false;
      setEntries((prev) => {
        if (isDuplicate(fullCitation, prev)) return prev;
        const info = classifyCitation(fullCitation);
        const entry: BibliographyEntry = {
          id: crypto.randomUUID(),
          rawInput,
          fullCitation,
          addedFrom: from,
          addedAt: Date.now(),
          ...info,
        };
        added = true;
        return [...prev, entry];
      });
      return added;
    },
    [isDuplicate]
  );

  const addEntries = useCallback(
    (items: { rawInput: string; fullCitation: string }[]): number => {
      let count = 0;
      setEntries((prev) => {
        const next = [...prev];
        for (const item of items) {
          if (isDuplicate(item.fullCitation, next)) continue;
          const info = classifyCitation(item.fullCitation);
          next.push({
            id: crypto.randomUUID(),
            rawInput: item.rawInput,
            fullCitation: item.fullCitation,
            addedFrom: "manual",
            addedAt: Date.now(),
            ...info,
          });
          count++;
        }
        return next;
      });
      return count;
    },
    [isDuplicate]
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => setEntries([]), []);

  const sortedEntries = sortBibliography(entries);

  return (
    <BibliographyContext.Provider
      value={{ entries, addEntry, addEntries, removeEntry, clearAll, sortedEntries }}
    >
      {children}
    </BibliographyContext.Provider>
  );
}

export function useBibliography() {
  const ctx = useContext(BibliographyContext);
  if (!ctx) throw new Error("useBibliography must be used within BibliographyProvider");
  return ctx;
}
