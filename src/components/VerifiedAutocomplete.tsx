import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface VerifiedSource {
  id: string;
  source_name: string;
  full_citation: string;
  source_type: string;
}

interface VerifiedAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelectCitation?: (citation: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function VerifiedAutocomplete({ value, onChange, onSelectCitation, placeholder, disabled }: VerifiedAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<VerifiedSource[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const search = async () => {
      if (value.length < 2) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }
      const { data } = await supabase
        .from("verified_sources")
        .select("id, source_name, full_citation, source_type")
        .ilike("search_text", `%${value.toLowerCase()}%`)
        .limit(8);

      if (data && data.length > 0) {
        setSuggestions(data);
        setIsOpen(true);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
    };

    const timer = setTimeout(search, 200);
    return () => clearTimeout(timer);
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

  const selectSuggestion = (source: VerifiedSource) => {
    onChange(source.source_name);
    onSelectCitation?.(source.full_citation);
    setIsOpen(false);
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

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm font-sans resize-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
        style={{ direction: "rtl" }}
        autoComplete="off"
      />
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-[200px] overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              className={`w-full text-right px-3 py-2 text-sm transition-colors border-b border-border/50 last:border-b-0 ${
                i === highlightIndex ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => selectSuggestion(s)}
            >
              <div className="flex items-center gap-2">
                <span className="text-primary text-xs">✓ מאומת</span>
                <span className="font-medium text-foreground">{s.source_name}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{s.full_citation}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
