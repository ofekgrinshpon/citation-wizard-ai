import { useState, useRef, useEffect } from "react";
import { searchLaws, type LawEntry } from "@/data/laws";

interface LawAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (law: LawEntry) => void;
  placeholder?: string;
}

export function LawAutocomplete({ value, onChange, onSelect, placeholder }: LawAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<LawEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const results = searchLaws(value);
    setSuggestions(results);
    setIsOpen(results.length > 0 && value.length >= 2);
    setHighlightIndex(-1);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      const selected = suggestions[highlightIndex];
      onChange(selected.name);
      onSelect(selected);
      setIsOpen(false);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder || "הקלד שם חוק..."}
        className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-foreground text-sm font-sans focus:border-primary/50 transition-colors"
        style={{ direction: "rtl" }}
        autoComplete="off"
      />
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-[240px] overflow-y-auto">
          {suggestions.map((law, i) => (
            <button
              key={i}
              className={`w-full text-right px-3 py-2.5 text-sm transition-colors border-b border-border/50 last:border-b-0 ${
                i === highlightIndex
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
              onClick={() => {
                onChange(law.name);
                onSelect(law);
                setIsOpen(false);
              }}
            >
              <div className="font-semibold text-foreground">{law.name}</div>
              <div className="text-xs text-text-dim mt-0.5">
                {law.hebrewYear && `${law.hebrewYear}–${law.gregorianYear}`}
                {law.isBasicLaw && " • חוק יסוד"}
                {law.isNewVersion && " • [נוסח חדש]"}
                {law.isCombinedVersion && " • [נוסח משולב]"}
                {law.collection && ` • ${law.collection}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
