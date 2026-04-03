import { useState } from "react";
import { FormattedCitation } from "./FormattedCitation";
import { PartyNameCheck } from "./PartyNameCheck";
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
  onUpdateAssistantContent?: (newContent: string) => void;
}

export function MessageBubble({ msg, detectedType, onChangeSourceType, onEdit, onUpdateAssistantContent }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(msg.content);
  const [showPartyCheck, setShowPartyCheck] = useState(false);
  const [isEditingCitation, setIsEditingCitation] = useState(false);
  const [citationEditValue, setCitationEditValue] = useState("");

  const isCaseLaw = detectedType === "case_law_published" || detectedType === "case_law_database";
  const isVerifiedSource = msg.content.startsWith("✓");

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

  const copyContent = async () => {
    const citationOnly = msg.content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/\[חסר:/.test(trimmed) || /המערכת זיהתה/.test(trimmed) || /הערה:/.test(trimmed)) return true;
        if (/^✓\s|^🏷️\s|^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(trimmed)) return false;
        if (/העוזר המשפטי/.test(trimmed)) return false;
        if (/^שלב \d|^זיהוי סוג|^נרמול|^יישום/.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .trim();

    // Build rich text (HTML) version with bold/italic formatting
    const htmlContent = citationOnly
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/##(.+?)##/g, "<i>$1</i>")
      .replace(/\n/g, "<br>");

    const plainContent = citationOnly
      .replace(/\*\*/g, "")
      .replace(/##/g, "");

    try {
      const htmlBlob = new Blob([`<div dir="rtl" style="font-family: 'David', 'Times New Roman', serif;">${htmlContent}</div>`], { type: "text/html" });
      const textBlob = new Blob([plainContent], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": htmlBlob,
          "text/plain": textBlob,
        }),
      ]);
    } catch {
      // Fallback for browsers that don't support ClipboardItem
      await navigator.clipboard.writeText(plainContent);
    }
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
                  <div key={i} className="flex items-center gap-2 flex-wrap mt-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="py-1 px-2 rounded-md text-xs cursor-help inline-block"
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

                    {isCaseLaw && !isVerifiedSource && (
                      <button
                        onClick={() => setShowPartyCheck((v) => !v)}
                        className="inline-flex items-center gap-1 py-1 px-2 rounded-md text-xs font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                        title="בדיקת שמות צדדים (כלל 18.4.4)"
                      >
                        <AlertTriangle size={13} />
                        <span>👤 בדיקת צדדים</span>
                      </button>
                    )}
                  </div>
                );
              }
              <button
                onClick={copyContent}
                className="text-xs bg-surface hover:bg-surface-hover border border-border rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
                title="העתק"
              >
                📋
              </button>
            </div>

            {showPartyCheck && (
              <PartyNameCheck
                onDismiss={() => setShowPartyCheck(false)}
                onRequestEdit={() => {
                  setShowPartyCheck(false);
                  // Extract the citation line for editing
                  const citationLine = msg.content
                    .split("\n")
                    .find((l) => l.trim() && !/^✓|^🏷️|^📐|^⚠️|^כלל:/.test(l.trim()));
                  setCitationEditValue(citationLine || msg.content);
                  setIsEditingCitation(true);
                }}
              />
            )}

            {isEditingCitation && (
              <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2.5" style={{ direction: "rtl" }}>
                <p className="text-xs text-muted-foreground mb-1.5">ערוך את שמות הצדדים באזכור:</p>
                <textarea
                  value={citationEditValue}
                  onChange={(e) => setCitationEditValue(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground leading-relaxed resize-none outline-none focus:border-primary transition-colors"
                  rows={2}
                  dir="rtl"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setIsEditingCitation(false);
                    }
                  }}
                />
                <div className="flex gap-2 mt-2 justify-end">
                  <button
                    onClick={() => {
                      const trimmed = citationEditValue.trim();
                      if (!trimmed) return;
                      // Replace the citation line in the full message content
                      const lines = msg.content.split("\n");
                      const citationIdx = lines.findIndex(
                        (l) => l.trim() && !/^✓|^🏷️|^📐|^⚠️|^כלל:/.test(l.trim())
                      );
                      if (citationIdx !== -1) {
                        lines[citationIdx] = trimmed;
                      }
                      onUpdateAssistantContent?.(lines.join("\n"));
                      setIsEditingCitation(false);
                    }}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                  >
                    ✓ עדכן אזכור
                  </button>
                  <button
                    onClick={() => setIsEditingCitation(false)}
                    className="px-3 py-1.5 text-xs rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
