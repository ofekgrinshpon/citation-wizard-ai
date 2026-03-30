import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RULE_EXPLANATIONS } from "@/data/ruleTooltips";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Extract rule number from a 📐 line */
function extractRuleNumber(line: string): string | null {
  const m = line.match(/כלל[:\s]*(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

export function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  const copyContent = () => {
    const plain = msg.content.replace(/\*\*/g, "").replace(/##/g, "");
    navigator.clipboard.writeText(plain);
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
          <div className="chat-bubble-user px-4 py-3 text-primary-foreground text-sm leading-relaxed">
            {msg.content}
          </div>
        ) : (
          <div className="chat-bubble-assistant px-4 py-3 text-foreground text-sm leading-relaxed">
            {msg.content.split("\n").map((line, i) => {
              if (!line.trim()) return <br key={i} />;

              // Rule reference line – make it a tooltip-rich badge
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

              // Line with missing data marker
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

            {/* Copy button */}
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
