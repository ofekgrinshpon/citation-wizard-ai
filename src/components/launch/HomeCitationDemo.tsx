import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Copy, Sparkles } from "lucide-react";
import { copyHomeCitationDemo } from "./homeCitationDemoClipboard";

const sample = "ע״א 6821/93 פס׳ 3 לפסק דינו של השופט ברק.";
const docket = "ע״א 6821/93";
const parties = "בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי";
const locator = ", פ״ד מט(4) 221, פס׳ 3 לפסק דינו של הנשיא ברק (1995).";

export function HomeCitationDemo() {
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const citationRef = useRef<HTMLParagraphElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCopyStatus("");
    setRevealed(true);
  }

  async function copyCitation() {
    try {
      const format = await copyHomeCitationDemo(docket, parties, locator);
      setCopyStatus(format === "rich" ? "האזכור הועתק עם עיצוב" : "האזכור הועתק כטקסט בלבד");
    } catch {
      citationRef.current?.focus();
      setCopyStatus("אפשר לסמן את האזכור ולהעתיק ידנית.");
    }
  }

  return (
    <section id="citation-demo" aria-labelledby={headingId} dir="rtl"
      className="rounded-2xl border border-primary/20 bg-card/90 p-3 text-start shadow-sm sm:p-4">
      <div className="mb-1 flex items-center gap-2 text-primary">
        <Sparkles aria-hidden="true" className="size-4 shrink-0" />
        <h2 id={headingId} className="[font-family:inherit] text-sm font-bold">נסו אזכור מהיר</h2>
      </div>
      <p id={hintId} className="mb-3 text-xs leading-relaxed text-muted-foreground">
        דוגמה מוכנה בלי הרשמה. לחצו על החץ או על Enter.
      </p>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor={fieldId}>פרטי המקור לדוגמה</label>
        <div className="flex items-center gap-1 rounded-xl border border-primary/30 bg-background p-1 focus-within:ring-2 focus-within:ring-primary/35">
          <textarea id={fieldId} value={sample} rows={2} readOnly inputMode="none"
            aria-describedby={`${hintId} ${statusId}`}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            className="min-w-0 flex-1 resize-none bg-transparent [font-family:inherit] px-2 py-1.5 text-base leading-5 text-foreground outline-none sm:h-11 sm:py-3 sm:text-sm" />
          <button type="submit" aria-label="הצגת האזכור לדוגמה" aria-controls={statusId} aria-expanded={revealed}
            className="grid size-11 shrink-0 place-items-center rounded-lg [font-family:inherit] bg-primary text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        </div>
      </form>

      <div id={statusId} aria-live="polite">
        {revealed && (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 pt-3">
            <p ref={citationRef} tabIndex={-1} className="break-words text-sm leading-relaxed text-foreground">
              {docket} <strong>{parties}</strong>{locator}
            </p>
            <button type="button" onClick={copyCitation}
              className="inline-flex min-h-11 items-center gap-1 rounded-md [font-family:inherit] text-xs font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <Copy aria-hidden="true" className="size-3.5" /> העתקת האזכור
            </button>
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">{copyStatus}</p>
          </div>
        )}
      </div>
    </section>
  );
}
