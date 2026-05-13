import { useEffect, useState } from "react";
import { BatchFootnoteBuilder } from "./BatchFootnoteBuilder";
import DocumentCheckPage from "./document-check/DocumentCheckPage";

type SubMode = "build" | "check";
const STORAGE_KEY = "footnotes_submode";

export function FootnotesSection() {
  const [subMode, setSubMode] = useState<SubMode>(() => {
    if (typeof window === "undefined") return "build";
    return (localStorage.getItem(STORAGE_KEY) as SubMode) || "build";
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, subMode); } catch {}
  }, [subMode]);

  const tabs: { id: SubMode; label: string; icon: string }[] = [
    { id: "build", label: "בניית הערות שוליים", icon: "📑" },
    { id: "check", label: "בדיקת מסמך", icon: "📄" },
  ];

  return (
    <div style={{ direction: "rtl" }}>
      <div className="pt-4">
        <div className="inline-flex gap-1 bg-muted rounded-lg p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSubMode(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                subMode === t.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="text-[11px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={subMode === "build" ? "" : "hidden"}>
        <BatchFootnoteBuilder />
      </div>
      <div className={subMode === "check" ? "" : "hidden"}>
        <DocumentCheckPage />
      </div>
    </div>
  );
}

export default FootnotesSection;
