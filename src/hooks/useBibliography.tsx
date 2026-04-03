import { useState, useCallback, useEffect, createContext, useContext } from "react";
import { useProjects } from "@/hooks/useProjects";

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

// Detect if text starts with an author name (not a law/case prefix)
function hasAuthorPrefix(text: string, isEnglish: boolean): boolean {
  const trimmed = text.trim().replace(/^\d+\.\s*/, "");

  if (isEnglish) {
    if (/^(The |An |A )?(Act|Law|Order|Regulation|Regulations|Statute|Code|Basic Law|Constitution|Section)\b/i.test(trimmed)) {
      return false;
    }
    if (/\bv\.\b|\bvs\.\b/i.test(trimmed)) return false;
    return /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,2}(?=,|\s+##|\s+\*\*)/.test(trimmed);
  }

  const nonAuthorStarters = /^(חוק|חוק-יסוד|חוק\s+יסוד|פקודת|פקודה|תקנות|תקנה|צו|נוהל|הוראת|הצעת|תזכיר|סעיף|סימן|פרק|תוספת|בית|פסק|דין|מדינת|הממשלה|הכנסת|משרד|רשות|בג"ץ|ע"א|רע"א|דנ"א|ע"פ|רע"פ|דנ"פ|ע"ע|עש"מ|בש"פ|ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק|ת"ט|תא"מ|ת"ד|עב"ל|ס"ק|ד"מ|ראו|ראה|השוו|השווה|שם|לעיל)\b/;
  if (nonAuthorStarters.test(trimmed)) return false;
  if (/נ['׳]\s|נגד\s/.test(trimmed)) return false;

  return /^[א-ת][א-ת"'׳״-]+(?:\s+[א-ת][א-ת"'׳״-]+){1,2}(?=,|\s+\*\*|\s+")/.test(trimmed);
}

export function classifyCitation(text: string): {
  sourceType: BibSourceCategory;
  language: "hebrew" | "english";
  subCategory: string;
  year?: number;
  authorSurname?: string;
} {
  const trimmed = text.trim();
  const isEnglish = /^[A-Za-z]/.test(trimmed) || /\bv\.\b|\bvs\.\b/.test(trimmed);
  const language = isEnglish ? "english" : "hebrew";

  let year: number | undefined;
  const yearMatch = trimmed.match(/\((\d{4})\)/) || trimmed.match(/\b(1\d{3}|20\d{2})\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  const authorDetected = hasAuthorPrefix(trimmed, isEnglish);
  const hasLiteratureMarkers = /מאמר|עיוני משפט|משפטים|הפרקליט|מחקרי משפט|כתב[\s-]עת/.test(trimmed) || /\bJ\.\b|\bL\.\s*Rev\b|\bBook\b|\bPress\b/i.test(trimmed);
  const hasPrimaryLegislation = /(?:^|\s|\()(חוק[\s-]יסוד|חוק|פקודת|פקודה)(?=[\s:-])/.test(trimmed) || /(?:^|\s)לחוק(?=\s)/.test(trimmed) || /^(Act|Law|Basic Law|Statute|Code)\b/i.test(trimmed);
  const hasSecondaryLegislation = /(?:^|\s|\()(תקנות|תקנה|צו|נוהל|הוראת)(?=[\s:-])/.test(trimmed) || /^(Regulations?|Order|Directive)\b/i.test(trimmed);
  const isSupremeCase = /בג"ץ|ע"א|רע"א|דנ"א|ע"פ|רע"פ|דנ"פ|ע"ע|עש"מ|בש"פ/.test(trimmed) || /Supreme Court|S\.Ct\./.test(trimmed);
  const isDistrictCase = /ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק/.test(trimmed) || /District Court|Circuit/.test(trimmed);
  const isMagistrateCase = /ת"ט|תא"מ|ת"ד/.test(trimmed) || /Magistrate/.test(trimmed);
  const isSpecializedCase = /עב"ל|ס"ק|ד"מ|בית[\s]הדין/.test(trimmed) || /Tribunal/.test(trimmed);
  const isGenericCase = /נ['׳]\s|נגד\s|\bv\.\b|\bvs\.\b/.test(trimmed) || /פד"י|פ"ד|דינים/.test(trimmed);

  let sourceType: BibSourceCategory = "unknown";
  let subCategory = "";

  if (authorDetected) {
    sourceType = "literature";
    subCategory = "ספרות";
  } else if (isSupremeCase) {
    sourceType = "caselaw_supreme";
    subCategory = "בית המשפט העליון";
  } else if (isDistrictCase) {
    sourceType = "caselaw_district";
    subCategory = "בית משפט מחוזי";
  } else if (isMagistrateCase) {
    sourceType = "caselaw_magistrate";
    subCategory = "בית משפט שלום";
  } else if (isSpecializedCase) {
    sourceType = "caselaw_specialized";
    subCategory = "בית דין מיוחד";
  } else if (isGenericCase) {
    sourceType = "caselaw_supreme";
    subCategory = "פסיקה";
  } else if (hasPrimaryLegislation) {
    sourceType = "legislation_primary";
    subCategory = /(חוק[\s-]יסוד|Basic Law)/.test(trimmed) ? "חוק יסוד" : "חוק/פקודה";
  } else if (hasSecondaryLegislation) {
    sourceType = "legislation_secondary";
    subCategory = "תקנות/צו";
  } else if (hasLiteratureMarkers) {
    sourceType = "literature";
    subCategory = "ספרות";
  } else if (/https?:\/\/|אתר|מרשתת|רשתת/.test(trimmed)) {
    sourceType = "misc";
    subCategory = "מקורות מרשתת";
  }

  let authorSurname: string | undefined;
  if (sourceType === "literature") {
    if (isEnglish) {
      const authorMatch = trimmed.match(/^([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2})/);
      if (authorMatch) {
        const parts = authorMatch[1].split(/\s+/);
        authorSurname = parts[parts.length - 1];
      }
    } else {
      const authorMatch = trimmed.match(/^([א-ת][א-ת"'׳״-]+(?:\s+[א-ת][א-ת"'׳״-]+){0,2})/);
      if (authorMatch) {
        const parts = authorMatch[1].split(/\s+/);
        authorSurname = parts[parts.length - 1];
      }
    }
  }

  return { sourceType, language, subCategory, year, authorSurname };
}

function normalizeBibliographyCitation(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(line)) return false;
      if (/^⚠️|המערכת זיהתה/.test(line)) return false;
      if (/^---FOOTNOTE/i.test(line)) return false;
      return true;
    })
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^\[?\d+\]?\.?\s*/, "")
    .replace(/^סעיף\s+[\dא-ת()./\-–]+\s+ל(?=(חוק|חוק-יסוד|חוק\s+יסוד|פקודת|פקודה|תקנות|צו|נוהל|הוראת))/g, "")
    .replace(/^section\s+[A-Za-z0-9()./\-–]+\s+of\s+/gi, "")
    .replace(/,?\s*בעמ['״]?\s*[\d\-–]+/g, "")
    .replace(/,?\s*עמ['״]?\s*[\d\-–]+/g, "")
    .replace(/,?\s*at\s+\d+(?:[\-–]\d+)?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim()
    .toLowerCase();
}

function rebuildBibliographyEntries(items: BibliographyEntry[]): BibliographyEntry[] {
  const seen = new Set<string>();
  const rebuilt: BibliographyEntry[] = [];

  for (const item of items) {
    if (!item?.fullCitation?.trim()) continue;

    const normalized = normalizeBibliographyCitation(item.fullCitation);
    if (!normalized) continue;
    if (/^שם(?:[.\s,]|$)/.test(normalized)) continue;
    if (/לעיל ה["'׳]?ש/.test(normalized)) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    rebuilt.push({
      ...item,
      rawInput: item.rawInput || item.fullCitation,
      addedFrom: item.addedFrom === "footnote" ? "footnote" : "manual",
      addedAt: item.addedAt || Date.now(),
      ...classifyCitation(item.fullCitation),
    });
  }

  return rebuilt;
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
      return (a.authorSurname || "").localeCompare(b.authorSurname || "", a.language === "english" ? "en" : "he");
    }
    // Everything else: chronological
    return (a.year || 9999) - (b.year || 9999);
  });
}

interface BibliographyContextValue {
  entries: BibliographyEntry[];
  addEntry: (rawInput: string, fullCitation: string, from: "footnote" | "manual") => boolean;
  addEntries: (items: { rawInput: string; fullCitation: string }[], from?: "footnote" | "manual") => number;
  syncFootnoteEntries: (items: { rawInput: string; fullCitation: string }[]) => number;
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
      if (Array.isArray(parsed)) return rebuildBibliographyEntries(parsed);
    }
  } catch {}
  return [];
}

export function BibliographyProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<BibliographyEntry[]>(loadBibEntries);

  useEffect(() => {
    setEntries((prev) => {
      const rebuilt = rebuildBibliographyEntries(prev);
      const unchanged = rebuilt.length === prev.length && rebuilt.every((entry, index) => {
        const current = prev[index];
        return current &&
          entry.id === current.id &&
          entry.fullCitation === current.fullCitation &&
          entry.sourceType === current.sourceType &&
          entry.language === current.language &&
          entry.subCategory === current.subCategory &&
          entry.authorSurname === current.authorSurname;
      });
      return unchanged ? prev : rebuilt;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(BIB_STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const isDuplicate = useCallback(
    (fullCitation: string, current: BibliographyEntry[]) => {
      const normalized = normalizeBibliographyCitation(fullCitation);
      return current.some((entry) => normalizeBibliographyCitation(entry.fullCitation) === normalized);
    },
    []
  );

  const addEntry = useCallback(
    (rawInput: string, fullCitation: string, from: "footnote" | "manual"): boolean => {
      let added = false;
      setEntries((prev) => {
        if (isDuplicate(fullCitation, prev)) return rebuildBibliographyEntries(prev);
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
        return rebuildBibliographyEntries([...prev, entry]);
      });
      return added;
    },
    [isDuplicate]
  );

  const addEntries = useCallback(
    (items: { rawInput: string; fullCitation: string }[], from: "footnote" | "manual" = "manual"): number => {
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
            addedFrom: from,
            addedAt: Date.now(),
            ...info,
          });
          count++;
        }
        return rebuildBibliographyEntries(next);
      });
      return count;
    },
    [isDuplicate]
  );

  const syncFootnoteEntries = useCallback((items: { rawInput: string; fullCitation: string }[]) => {
    const normalizedItems = rebuildBibliographyEntries(
      items.map((item) => ({
        id: crypto.randomUUID(),
        rawInput: item.rawInput,
        fullCitation: item.fullCitation,
        addedFrom: "footnote" as const,
        addedAt: Date.now(),
        ...classifyCitation(item.fullCitation),
      }))
    );

    setEntries((prev) => {
      const manualEntries = prev.filter((entry) => entry.addedFrom !== "footnote");
      return rebuildBibliographyEntries([...manualEntries, ...normalizedItems]);
    });

    return normalizedItems.length;
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => setEntries([]), []);

  const sortedEntries = sortBibliography(entries);

  return (
    <BibliographyContext.Provider
      value={{ entries, addEntry, addEntries, syncFootnoteEntries, removeEntry, clearAll, sortedEntries }}
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
