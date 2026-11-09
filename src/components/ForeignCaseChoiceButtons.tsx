import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ForeignCaseChoice } from "@/lib/foreignCaseChoice";

interface Props {
  choice: ForeignCaseChoice;
  /** Return false when the choice was not applied, so the options unlock again. */
  onSelect: (optionId: string) => boolean | void;
  disabled?: boolean;
}

/** Record-bound options for a foreign ruling or its parallel reports. */
export function ForeignCaseChoiceButtons({ choice, onSelect, disabled }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const label = choice.stage === "decision" ? "בחירת פסק הדין" : "בחירת מראה המקום";
  return (
    <div role="group" aria-label={label} className="mt-2 space-y-1.5">
      {choice.options.map((o, i) => (
        <div key={o.id} className="flex items-stretch gap-1.5">
          <button
            type="button"
            disabled={chosen !== null || disabled}
            aria-label={`${i + 1}. ${o.label}`}
            onClick={() => {
              setChosen(o.id);
              let applied: boolean | void = false;
              try { applied = onSelect(o.id); } finally { if (applied === false) setChosen(null); }
            }}
            className="flex-1 text-left p-2 rounded-lg border border-primary/20 hover:bg-primary/10 hover:border-primary/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            dir="ltr"
          >
            <span className="text-muted-foreground me-1.5">{i + 1}.</span>
            <span>{o.label}</span>
          </button>
          <a
            href={o.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`מקור לאפשרות ${i + 1}`}
            title={o.url}
            className="inline-flex items-center px-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      ))}
    </div>
  );
}
