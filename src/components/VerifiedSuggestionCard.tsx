import type { VerifiedSourceMatch } from "@/lib/verifiedSources";

interface VerifiedSuggestionCardProps {
  suggestion: VerifiedSourceMatch;
  onAccept: () => void;
  onReject: () => void;
}

export function VerifiedSuggestionCard({ suggestion, onAccept, onReject }: VerifiedSuggestionCardProps) {
  return (
    <div
      className="my-3 p-4 rounded-xl border border-primary/30 bg-primary/5 animate-fade-in"
      style={{ direction: "rtl" }}
    >
      <div className="flex items-start gap-2 mb-3">
        <span className="text-lg">🔍</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground mb-1">
            האם התכוונת למקור הבא?
          </p>
          <p className="text-xs text-muted-foreground mb-2">
            נמצא מקור מאומת דומה במאגר:
          </p>
          <div className="p-3 rounded-lg bg-background border border-border text-sm leading-relaxed text-foreground">
            {suggestion.full_citation.split("**").map((part, i) =>
              i % 2 === 1 ? (
                <strong key={i}>{part}</strong>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onReject}
          className="px-4 py-2 text-xs rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          לא, להשתמש במה שהקלדתי
        </button>
        <button
          onClick={onAccept}
          className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-medium"
        >
          כן, להשתמש במקור המאומת ✓
        </button>
      </div>
    </div>
  );
}
