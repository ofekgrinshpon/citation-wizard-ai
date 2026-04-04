import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";

interface VerifiedSource {
  id: string;
  source_name: string;
  full_citation: string;
  source_type: string;
  year: string | null;
  volume: string | null;
  page: string | null;
  metadata: Record<string, unknown> | null;
}

interface VerifiedAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelectCitation?: (citation: string, metadata?: VerifiedSource) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  inputType?: "textarea" | "input";
  className?: string;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  caselaw: { label: "פסיקה", icon: "⚖️" },
  legislation_primary: { label: "חקיקה ראשית", icon: "📜" },
  legislation_secondary: { label: "חקיקת משנה", icon: "📋" },
  literature: { label: "ספרות", icon: "📚" },
  other: { label: "אחר", icon: "📁" },
};

export function VerifiedAutocomplete({
  value,
  onChange,
  onSelectCitation,
  placeholder,
  disabled,
  inputType = "textarea",
  className,
}: VerifiedAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<VerifiedSource[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const updateDropdownPosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 300;
    const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, []);

  useEffect(() => {
    const search = async () => {
      if (value.length < 2) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      // Split into individual words for better partial matching
      // e.g. "חוק יסוד הכנסת" needs to match "חוק-יסוד: הכנסת"
      const words = value.toLowerCase().split(/[\s\-:]+/).filter(w => w.length >= 2);

      // Also check if input contains a case number pattern (e.g., "1514/01" or "1514")
      const caseNumberParts = value.match(/\d+(?:\/\d+)?/g) || [];

      const allTerms = [...words, ...caseNumberParts].filter(t => t.length >= 2);
      // Strip quotes and special chars that break PostgREST or() filters
      const uniqueTerms = Array.from(new Set(allTerms)).map(t => t.replace(/["״׳'\\,()]/g, '')).filter(t => t.length >= 2);

      const orConditions = uniqueTerms.flatMap(w => [
        `search_text.ilike.%${w}%`,
        `source_name.ilike.%${w}%`,
        `full_citation.ilike.%${w}%`,
      ]).join(',');

      const { data } = await supabase
        .from("verified_sources")
        .select("id, source_name, full_citation, source_type, year, volume, page, metadata")
        .eq("verification_status", "verified")
        .or(orConditions)
        .limit(8);

      if (data && data.length > 0) {
        setSuggestions(data as VerifiedSource[]);
        setIsOpen(true);
        setHighlightIndex(-1);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
    };

    const timer = setTimeout(search, 250);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      window.addEventListener("scroll", updateDropdownPosition, true);
      window.addEventListener("resize", updateDropdownPosition);
      return () => {
        window.removeEventListener("scroll", updateDropdownPosition, true);
        window.removeEventListener("resize", updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        // Also check if click is inside the portal dropdown
        const portal = document.getElementById("verified-dropdown-portal");
        if (portal && portal.contains(e.target as Node)) return;
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectSuggestion = (source: VerifiedSource) => {
    onChange(source.source_name);
    onSelectCitation?.(source.full_citation, source);
    setIsOpen(false);

    supabase.rpc("increment_usage_count", { source_id: source.id }).then(() => {});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const defaultClass =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm font-sans resize-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50";

  const getCategoryInfo = (sourceType: string) => {
    return CATEGORY_LABELS[sourceType] || { label: sourceType, icon: "📄" };
  };

  const dropdown = isOpen && suggestions.length > 0 && createPortal(
    <div id="verified-dropdown-portal" style={dropdownStyle}>
      <div className="bg-card border border-primary/20 rounded-xl shadow-2xl max-h-[280px] overflow-y-auto">
        <div className="px-3 py-2 border-b border-border/50 bg-primary/5 rounded-t-xl">
          <span className="text-[11px] text-primary font-semibold flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px]">✓</span>
            מקורות מאומתים • {suggestions.length} תוצאות
          </span>
        </div>
        {suggestions.map((s, i) => {
          const cat = getCategoryInfo(s.source_type);
          return (
            <button
              key={s.id}
              className={`w-full text-right px-3 py-3 text-sm transition-all border-b border-border/30 last:border-b-0 ${
                i === highlightIndex
                  ? "bg-primary/10"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => selectSuggestion(s)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs">{cat.icon}</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                    <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.78 5.28l-4.5 5a.75.75 0 0 1-1.06.02l-2-2a.75.75 0 1 1 1.06-1.06l1.47 1.47 3.97-4.47a.75.75 0 0 1 1.06 1.04z"/>
                  </svg>
                  מאומת
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{cat.label}</span>
                {s.year && (
                  <span className="text-[10px] text-muted-foreground">{s.year}</span>
                )}
              </div>
              <div className="font-medium text-foreground truncate">{s.source_name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{s.full_citation}</div>
            </button>
          );
        })}
        <div className="px-3 py-1.5 bg-muted/30 rounded-b-xl">
          <span className="text-[10px] text-muted-foreground">בחר מקור למילוי אוטומטי מיידי</span>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={wrapperRef} className="relative flex-1">
      {inputType === "textarea" ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className={className || defaultClass}
          style={{ direction: "rtl" }}
          autoComplete="off"
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={className || defaultClass}
          style={{ direction: "rtl" }}
          autoComplete="off"
        />
      )}
      {dropdown}
    </div>
  );
}
