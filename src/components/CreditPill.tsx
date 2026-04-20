import { useNavigate } from "react-router-dom";
import { Coins, Infinity as InfinityIcon } from "lucide-react";
import { useCredits } from "@/hooks/useCredits";
import { cn } from "@/lib/utils";

interface CreditPillProps {
  className?: string;
  compact?: boolean;
}

export const CreditPill = ({ className, compact }: CreditPillProps) => {
  const navigate = useNavigate();
  const {
    plan,
    planMeta,
    isAdmin,
    includedCreditsRemaining,
    includedCreditsTotal,
    topupCreditsRemaining,
    totalCreditsAvailable,
    loading,
  } = useCredits();

  if (loading) return null;

  const ratio = includedCreditsTotal > 0 ? includedCreditsRemaining / includedCreditsTotal : 0;
  const ringColor =
    ratio > 0.5 ? "bg-primary/20 text-primary" : ratio > 0.2 ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" : "bg-destructive/15 text-destructive";

  return (
    <button
      onClick={() => navigate("/profile?tab=account")}
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border border-border bg-card hover:bg-muted/60 transition-colors",
        className,
      )}
      title={
        isAdmin
          ? "Admin — ללא הגבלה"
          : `${planMeta.label} · נכלל: ${includedCreditsRemaining}/${includedCreditsTotal} · טעינות: ${topupCreditsRemaining}`
      }
    >
      <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full", isAdmin ? "bg-primary/20 text-primary" : ringColor)}>
        {isAdmin ? <InfinityIcon className="w-3 h-3" /> : <Coins className="w-3 h-3" />}
      </span>
      {!compact && <span className="text-muted-foreground">{planMeta.shortLabel}</span>}
      <span className="text-foreground tabular-nums">
        {isAdmin ? "∞" : `${totalCreditsAvailable} קרדיטים`}
      </span>
    </button>
  );
};
