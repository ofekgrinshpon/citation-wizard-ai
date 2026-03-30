import { FormattedCitation } from "./FormattedCitation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div
      className="flex items-start gap-2.5 mb-4 animate-fade-in"
      style={{ direction: "rtl" }}
    >
      <div
        className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-base ${
          isUser ? "avatar-user" : "avatar-assistant"
        }`}
      >
        {isUser ? "⚖" : "🏛"}
      </div>

      <div className="max-w-[85%] min-w-0">
        {isUser ? (
          <div className="chat-bubble-user px-4 py-3 text-primary-foreground text-sm leading-relaxed">
            {msg.content}
          </div>
        ) : (
          <div className="chat-bubble-assistant px-4 py-3 text-foreground text-sm leading-relaxed">
            {msg.content.split("\n").map((line, i) => {
              if (!line.trim()) return <br key={i} />;
              return (
                <div key={i} className="my-0.5">
                  <FormattedCitation text={line} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
