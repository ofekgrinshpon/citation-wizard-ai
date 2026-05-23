import { Card, CardContent } from "@/components/ui/card";
import { Wrench } from "lucide-react";

interface MaintenanceCardProps {
  /** Main Hebrew headline, e.g. "מצב מחקר משפטי בשדרוג" */
  title: string;
  /** Optional sub-message. Defaults to a generic "חוזר בקרוב" line. */
  message?: string;
}

/**
 * Neutral maintenance / offline notice. Used while the Research engine and
 * the Academic chapter-writing engine are being rebuilt. No ETA, no tracking.
 * Renders inline inside the chat / chapter area; callers are responsible for
 * also disabling the submit button.
 */
export function MaintenanceCard({ title, message }: MaintenanceCardProps) {
  return (
    <Card
      className="border-border bg-muted/30"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <CardContent className="p-5 flex items-start gap-3">
        <Wrench className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
        <div className="space-y-1.5">
          <h3 className="text-foreground text-sm font-bold leading-tight">{title}</h3>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {message ?? "המנוע נמצא בשדרוג. חוזר בקרוב. שאר הפיצ'רים זמינים כרגיל."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
