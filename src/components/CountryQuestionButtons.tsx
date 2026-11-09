import { useState } from "react";
import type { CountryQuestion } from "@/lib/countryQuestion";
import type { QuickCountryId } from "@/lib/foreignQuickPick";

interface Props {
  question: CountryQuestion;
  /** Return false when the answer was not applied, so the buttons unlock again. */
  onAnswer: (country: QuickCountryId) => boolean | void;
}

/** "Which country is this?" — asked instead of guessing; answering starts one explicit generation. */
export function CountryQuestionButtons({ question, onAnswer }: Props) {
  const [chosen, setChosen] = useState<QuickCountryId | null>(null);
  return (
    <div role="group" aria-label="באיזו מדינה מדובר?" className="mt-2 flex flex-wrap gap-1.5">
      {question.options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={chosen !== null}
          onClick={() => {
            setChosen(o.id);
            let applied: boolean | void = false;
            try { applied = onAnswer(o.id); } finally { if (applied === false) setChosen(null); }
          }}
          className="rounded-md border border-primary/20 bg-background px-2.5 py-1.5 text-sm hover:bg-primary/10 hover:border-primary/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
