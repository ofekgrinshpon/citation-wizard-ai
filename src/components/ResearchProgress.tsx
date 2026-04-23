import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const STEPS = [
  "חושב...",
  "פותח את הספרים...",
  "מחפש בפסקי הדין...",
  "קורא את החוק...",
  "מצליב נתונים...",
  "בונה טיעון מרכזי...",
  "בונה את הערות השוליים לפי כללי האזכור האחיד...",
  "מלטש את המשלב הלשוני לרמה אקדמית...",
  "מבצע בקרת איכות סופית על הפלט...",
  "מסיים לכתוב...",
];

const STEP_INTERVAL_MS = 10_000;

export function ResearchProgress() {
  // Number of steps revealed so far (0..STEPS.length).
  // The last revealed step is "active" (spinner); all earlier ones are "done".
  const [revealedCount, setRevealedCount] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setRevealedCount((c) => Math.min(c + 1, STEPS.length));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const visibleSteps = STEPS.slice(0, revealedCount);

  return (
    <Card className="mt-4 border-border overflow-hidden relative">
      <CardContent className="p-4 sm:p-6">
        {/* Blinking skeleton background */}
        <div className="space-y-5 opacity-40 animate-pulse" aria-hidden="true">
          <div>
            <Skeleton className="h-5 w-24 mb-3" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full mt-2" />
          </div>
          <div>
            <Skeleton className="h-5 w-32 mb-3" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full mt-2" />
            <Skeleton className="h-4 w-2/3 mt-2" />
          </div>
          <div>
            <Skeleton className="h-5 w-28 mb-3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5 mt-2" />
          </div>
        </div>

        {/* Overlay sequential step list */}
        <div
          className="absolute inset-0 flex items-center justify-center px-4 sm:px-6"
          dir="rtl"
        >
          <div className="w-full max-w-md bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg p-4 sm:p-5">
            <ol className="space-y-2">
              {visibleSteps.map((label, i) => {
                const isActive = i === visibleSteps.length - 1;
                const isDone = !isActive;
                return (
                  <li
                    key={i}
                    className="flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      {isDone ? (
                        <CheckCircle2
                          className="w-4 h-4 text-emerald-500"
                          aria-label="הושלם"
                        />
                      ) : (
                        <Loader2
                          className="w-4 h-4 text-primary animate-spin"
                          aria-label="בעיבוד"
                        />
                      )}
                    </span>
                    <span
                      className={
                        isActive
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
