import { useState } from "react";
import { Copy, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReLexLogo } from "@/components/ReLexLogo";
import { renderAnswerMarkdown } from "@/lib/legalQa/renderAnswerMarkdown";
import { normalizeAnswerForDisplay } from "@/lib/legalQa/footnoteDisplay";
import { normalizeHebrewNumberRanges } from "@/lib/hebrewNumberRange";
import { copyPlainText } from "@/lib/clipboard";
import type { MessageRow, ChatFootnote } from "@/lib/researchConversation";

function footnoteText(fn: ChatFootnote): string {
  if (fn.sources && fn.sources.length > 1) {
    return fn.sources.map((s) => `${s.title}${s.url ? ` ${s.url}` : ""}`).join("; ");
  }
  return `${fn.title}${fn.url ? ` — ${fn.url}` : ""}`;
}

function Footnotes({ footnotes }: { footnotes: ChatFootnote[] }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h4 className="text-xs font-bold text-muted-foreground mb-2">הערות שוליים</h4>
      <ol className="space-y-1.5 text-[13px] text-foreground">
        {footnotes.map((fn) => {
          const items = fn.sources && fn.sources.length > 1 ? fn.sources : [{ title: fn.title, url: fn.url }];
          return (
            <li key={fn.number} className="leading-relaxed">
              <span className="font-medium">{fn.number}.</span>{" "}
              {items.map((s, i) => (
                <span key={i}>
                  {normalizeHebrewNumberRanges(s.title)}
                  {s.url ? (
                    <>
                      {" "}
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                        {s.url}
                      </a>
                    </>
                  ) : null}
                  {i < items.length - 1 ? "; " : ""}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ResearchChatMessage({
  message,
  onOptionClick,
  optionsEnabled = false,
}: {
  message: MessageRow;
  onOptionClick?: (option: string) => void;
  optionsEnabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-start mb-4" dir="rtl">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
          {message.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 text-[11px]">
                  <FileText className="w-3 h-3" />
                  {a.file_name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const footnotes = Array.isArray(message.footnotes) ? message.footnotes : [];
  const options = Array.isArray(message.metadata?.options) ? (message.metadata!.options as string[]) : [];
  const isAnswer = message.kind === "research_answer";

  const handleCopy = async () => {
    const parts = [normalizeAnswerForDisplay(message.content).trim()];
    if (footnotes.length) {
      parts.push("", "הערות שוליים:");
      footnotes.forEach((fn) => parts.push(`${fn.number}. ${footnoteText(fn)}`));
    }
    await copyPlainText(parts.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-start gap-2.5 mb-5" dir="rtl">
      <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center">
        <ReLexLogo size={16} showText={false} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {isAnswer
            ? renderAnswerMarkdown(normalizeAnswerForDisplay(message.content))
            : message.content}
        </div>
        {options.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((o) => (
              <Button
                key={o}
                variant="outline"
                size="sm"
                className="h-auto py-1.5 text-xs rounded-full"
                disabled={!optionsEnabled}
                onClick={() => onOptionClick?.(o)}
              >
                {o}
              </Button>
            ))}
          </div>
        )}
        {footnotes.length > 0 && <Footnotes footnotes={footnotes} />}
        {isAnswer && (
          <div className="mt-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={handleCopy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "הועתק" : "העתק"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
