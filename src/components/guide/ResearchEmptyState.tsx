import { useState } from "react";
import { PlayCircle, Search, ShieldCheck, FileText } from "lucide-react";
import { ReLexLogo } from "@/components/ReLexLogo";
import { UserGuideModal } from "@/components/guide/UserGuideModal";
import { safeStorage } from "@/lib/safeStorage";

const ONBOARDING_SEEN_KEY = "relex_onboarding_v1_seen";

const VALUE_STEPS = [
  {
    icon: Search,
    title: "איתור מקורות",
    text: "איתור וקריאה של פסקי דין, חקיקה ומאמרים רלוונטיים.",
  },
  {
    icon: ShieldCheck,
    title: "אימות טענות",
    text: "בדיקה שכל טענה משפטית נתמכת בפועל במקור.",
  },
  {
    icon: FileText,
    title: "תשובה עם הערות שוליים",
    text: "ניסוח מנומק עם אזכורים לפי כללי האזכור האחיד.",
  },
];

export const RESEARCH_PROMPT_EXAMPLES = [
  "חובת תום הלב במשא ומתן לקראת כריתת חוזה",
  "התנאים להרמת מסך ההתאגדות לפי חוק החברות",
  "אחריות שילוחית של מעביד בדיני נזיקין",
];

export function ResearchEmptyState({
  onPickExample,
  onStart,
  hasUploadedFiles = false,
}: {
  onPickExample: (text: string) => void;
  onStart: () => void;
  hasUploadedFiles?: boolean;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [seen, setSeen] = useState(
    () => safeStorage.getItem(ONBOARDING_SEEN_KEY) === "true",
  );

  const openGuide = () => {
    setGuideOpen(true);
    if (!seen) {
      safeStorage.setItem(ONBOARDING_SEEN_KEY, "true");
      setSeen(true);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center h-full py-8 px-4 text-center"
      style={{ direction: "rtl" }}
    >
      <div className="mb-4">
        <ReLexLogo size={56} />
      </div>

      <h2 className="text-foreground text-lg sm:text-xl font-bold mb-2">
        מחקר וכתיבה משפטית מעוגנים במקורות
      </h2>
      <p className="text-muted-foreground text-sm max-w-xl mb-6">
        {hasUploadedFiles
          ? "שאלו שאלה על המסמכים שהועלו – התשובה תתבסס על תוכן הקבצים ועל המאגר הפנימי"
          : "שאלו שאלה משפטית בשפה חופשית, וקבלו תשובה מנומקת עם אזכורים מלאים."}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl mb-6">
        {VALUE_STEPS.map((step) => (
          <div
            key={step.title}
            className="rounded-xl border border-border bg-card p-3 text-right"
          >
            <step.icon className="w-4 h-4 text-primary mb-1.5" />
            <p className="text-sm font-semibold text-foreground">{step.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              {step.text}
            </p>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-xs mb-2">שאלות לדוגמה:</p>
      <div className="flex flex-wrap gap-2 justify-center max-w-2xl mb-6">
        {RESEARCH_PROMPT_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPickExample(ex)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary/40 hover:bg-muted transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onStart}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          style={{ background: "var(--gradient-primary)" }}
        >
          התחילו מחקר
        </button>
        <button
          type="button"
          onClick={openGuide}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <PlayCircle className="w-4 h-4 text-primary" />
          איך ReLex עובד? (25 שניות)
          {!seen && (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </div>

      <UserGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}
