import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPT_EXT = /\.(pdf|docx)$/i;

export type ComposerHandle = { focus: (opts?: FocusOptions) => void; setText: (t: string) => void };

export const ConversationComposer = forwardRef<ComposerHandle, {
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  allowFiles?: boolean;
  onSend: (text: string, files: File[]) => Promise<boolean> | boolean;
}>(function ConversationComposer({ disabled, sending, placeholder, allowFiles = true, onSend }, ref) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: (opts?: FocusOptions) => taRef.current?.focus(opts),
    setText: (t: string) => { setText(t); setTimeout(() => taRef.current?.focus(), 0); },
  }));

  const canSend = !disabled && !sending && (text.trim().length > 0 || files.length > 0);

  const submit = async () => {
    if (!canSend) return;
    const ok = await onSend(text.trim(), files);
    if (ok) {
      setText("");
      setFiles([]);
    }
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ACCEPT_EXT.test(f.name)) { toast.error(`${f.name}: רק PDF/DOCX`); continue; }
      if (f.size > MAX_FILE_BYTES) { toast.error(`${f.name}: קובץ גדול מדי (עד 8MB)`); continue; }
      if (next.length >= MAX_FILES) { toast.error(`ניתן לצרף עד ${MAX_FILES} קבצים`); break; }
      next.push(f);
    }
    setFiles(next);
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-2" dir="rtl">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground">
              <FileText className="w-3 h-3" />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <button aria-label="הסר קובץ" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder={placeholder ?? "כתבו הודעה..."}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none max-h-48 min-h-[40px]"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        {allowFiles && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 flex-shrink-0"
              aria-label="צרף קובץ"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
          </>
        )}
        <Button
          type="button"
          size="icon"
          className="h-9 w-9 flex-shrink-0 rounded-full"
          aria-label="שלח"
          disabled={!canSend}
          onClick={() => void submit()}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
});
