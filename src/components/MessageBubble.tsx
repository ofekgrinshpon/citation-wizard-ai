import { useState } from "react";
import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RULE_EXPLANATIONS } from "@/data/ruleTooltips";
import { SourceTypeConfirmation } from "./SourceTypeConfirmation";
import { VerifiedAutocomplete } from "./VerifiedAutocomplete";
import type { SourceType } from "@/data/abbreviations";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Extract rule number from a 📐 line */
function extractRuleNumber(line: string): string | null {
  const m = line.match(/כלל[:\s]*(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

interface MessageBubbleProps {
  msg: Message;
  detectedType?: SourceType;
  onChangeSourceType?: (newType: SourceType) => void;
  onEdit?: (newContent: string) => void;
}

export function MessageBubble({ msg, detectedType, onChangeSourceType, onEdit }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(msg.content);

  const handleStartEdit = () => {
    setEditValue(msg.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(msg.content);
  };

  const handleSubmitEdit = () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (trimmed === msg.content.trim()) {
      setIsEditing(false);
      return;
    }
    onEdit?.(trimmed);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitEdit();
    }
    if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const copyContent = () => {
    const citationOnly = msg.content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/\[חסר:/.test(trimmed) || /המערכת זיהתה/.test(trimmed) || /הערה:/.test(trimmed)) return true;
        if (/^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(trimmed)) return false;
        if (/העוזר המשפטי/.test(trimmed)) return false;
        if (/^שלב \d|^זיהוי סוג|^נרמול|^יישום/.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .replace(/\*\*/g, "")
      .replace(/##/g, "")
      .trim();
    navigator.clipboard.writeText(citationOnly);
    toast.success("הועתק ללוח!");
  };

  const isRuleLine = (line: string) =>
    /^📐|^כלל:|^Based on Rule|^Rule \d/.test(line.trim());
  const hasMissingMarker = (line: string) => /\[חסר:/.test(line);

  return (
    <div
      className="flex items-start gap-2.5 mb-4 animate-fade-in group"
      style={{ direction: "rtl" }}
    >
      <div
        className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-base ${
          isUser ? "avatar-user" : "avatar-assistant"
        }`}
      >
        {isUser ? "⚖" : "🏛"}
      </div>

      <div className="max-w-[85%] min-w-0 relative">
        {isUser ? (
          isEditing ? (
            <div className="chat-bubble-user px-3 py-2 text-sm" onKeyDown={(e) => {
              if (e.key === "Escape") {
                handleCancelEdit();
              }
            }}>
              <VerifiedAutocomplete
                value={editValue}
                onChange={setEditValue}
                onSelectCitation={(citation) => {
                  setEditValue(citation);
                }}
                placeholder=""
                disabled={false}
                inputType="input"
                className="w-full bg-transparent border-none outline-none text-primary-foreground text-sm leading-relaxed placeholder:text-primary-foreground/50"
              />
              <div className="flex gap-2 mt-2 justify-end" style={{ direction: "rtl" }}>
                <button
                  onClick={handleSubmitEdit}
                  className="px-3 py-1.5 text-xs rounded-lg bg-background text-primary font-medium hover:bg-background/90 transition-colors"
                >
                  עדכן אזכור ⇧
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-xs rounded-lg bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
                >
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="chat-bubble-user px-4 py-3 text-primary-foreground text-sm leading-relaxed flex-1">
                {msg.content}
              </div>
              {onEdit && (
                <button
                  onClick={handleStartEdit}
                  className="flex-shrink-0 mt-1 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 border border-border rounded-md px-2 py-1.5 transition-colors"
                  title="ערוך"
                >
                  ✏️
                </button>
              )}
            </div>
          )
        ) : (
          <div className="chat-bubble-assistant px-4 py-3 text-foreground text-sm leading-relaxed">
            {detectedType && onChangeSourceType && (
              <SourceTypeConfirmation
                detectedType={detectedType}
                onChangeType={onChangeSourceType}
              />
            )}
            {msg.content.split("\n").map((line, i) => {
              if (!line.trim()) return <br key={i} />;

              if (isRuleLine(line)) {
                const ruleNum = extractRuleNumber(line);
                const explanation = ruleNum ? RULE_EXPLANATIONS[ruleNum] : null;

                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <div
                        className="mt-2 py-1 px-2 rounded-md text-xs cursor-help inline-block"
                        style={{
                          background: "hsl(var(--primary) / 0.1)",
                          color: "hsl(var(--primary))",
                        }}
                      >
                        {line}
                      </div>
                    </TooltipTrigger>
                    {explanation && (
                      <TooltipContent
                        side="top"
                        className="max-w-xs text-right"
                        style={{ direction: "rtl" }}
                      >
                        <p className="text-xs font-semibold text-primary mb-0.5">
                          כלל {ruleNum}
                        </p>
                        <p className="text-xs">{explanation}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              }

              if (hasMissingMarker(line)) {
                return (
                  <div key={i} className="my-0.5">
                    <FormattedCitation
                      text={line}
                      highlightMissing
                      enableTooltips
                    />
                  </div>
                );
              }

              return (
                <div key={i} className="my-0.5">
                  <FormattedCitation text={line} enableTooltips />
                </div>
              );
            })}

            <button
              onClick={copyContent}
              className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-surface hover:bg-surface-hover border border-border rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
              title="העתק"
            >
              📋
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
