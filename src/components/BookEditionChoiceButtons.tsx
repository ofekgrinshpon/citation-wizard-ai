import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { BookEditionChoice } from "@/lib/citationPlanner";

interface Props {
  choice: BookEditionChoice;
  onSelect: (optionId: string) => boolean | void;
  disabled?: boolean;
}

export function BookEditionChoiceButtons({ choice, onSelect, disabled }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const busy = useRef(false);
  const select = (id: string) => {
    if (busy.current || disabled) return;
    busy.current = true;
    setChosen(id);
    let applied: boolean | void = false;
    try { applied = onSelect(id); }
    finally { if (applied === false) { busy.current = false; setChosen(null); } }
  };
  return (
    <div role="group" aria-label="בחירת מהדורת הספר" className="mt-2 space-y-1.5">
      <p className="text-xs text-muted-foreground">הבחירה משתמשת במקורות שכבר נמצאו, ללא חיפוש נוסף וללא חיוב נוסף.</p>
      {choice.options.map(o => (
        <div key={o.id} className="flex items-stretch gap-1.5">
          <button type="button" disabled={chosen !== null || disabled} onClick={() => select(o.id)}
            className="flex-1 text-left p-2 rounded-lg border border-primary/20 hover:bg-primary/10 disabled:opacity-60" dir="ltr">
            {o.label}
          </button>
          <a href={o.url} target="_blank" rel="noopener noreferrer" aria-label={`מקור למהדורה ${o.year}`}
            className="inline-flex items-center px-2 rounded-lg border border-border">
            <ExternalLink size={14} />
          </a>
        </div>
      ))}
      <button type="button" disabled={chosen !== null || disabled} onClick={() => select("keep-missing")}
        className="p-2 rounded-lg border border-border disabled:opacity-60">להשאיר את השנה חסרה</button>
    </div>
  );
}
