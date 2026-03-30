import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  const copyContent = () => {
    const plain = msg.content.replace(/\*\*/g, "").replace(/##/g, "");
    navigator.clipboard.writeText(plain);
    toast.success("הועתק ללוח!");
  };

  // Detect rule reference lines and [חסר:...] markers
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

              // Rule reference line
              if (isRuleLine(line)) {
                return (
                  <div
                    key={i}
                    className="mt-2 py-1 px-2 rounded-md text-xs"
                    style={{
                      background: "hsl(var(--primary) / 0.1)",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    {line}
                  </div>
                );
              }

              // Line with missing data marker
              if (hasMissingMarker(line)) {
                return (
                  <div key={i} className="my-0.5">
                    <FormattedCitation text={line} highlightMissing />
                  </div>
                );
              }

              return (
                <div key={i} className="my-0.5">
                  <FormattedCitation text={line} />
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
