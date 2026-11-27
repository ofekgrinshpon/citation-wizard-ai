import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import { israeliPartyDecisionLabel, israeliPartyOptionId, type IsraeliPartyChoice } from "../../supabase/functions/_shared/israeliPartyDecisions.ts";

export function IsraeliPartyChoiceButtons({ choice, onSelect }: {
  choice: IsraeliPartyChoice;
  onSelect: (optionId: string) => boolean | void;
}) {
  const pending = useRef(false);
  return <div role="group" aria-label="בחירת החלטה מאומתת" dir="rtl" className="mt-2 space-y-1.5">
    {choice.records.map((record, index) => {
      const id = israeliPartyOptionId(record);
      return <div key={id} className="flex items-stretch gap-1.5">
        <button type="button" onClick={() => {
          if (pending.current) return;
          pending.current = true;
          let applied: boolean | void = false;
          try { applied = onSelect(id); } finally { if (applied === false) pending.current = false; }
        }} className="flex-1 p-2 text-right rounded-lg border border-primary/20 hover:bg-primary/10">
          {israeliPartyDecisionLabel(record)}
        </button>
        <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer"
          aria-label={`מקור להחלטה ${index + 1}`} className="inline-flex items-center px-2 rounded border border-border">
          <ExternalLink size={14} />
        </a>
      </div>;
    })}
  </div>;
}
