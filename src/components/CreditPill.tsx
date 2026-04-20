import { useNavigate } from "react-router-dom";
import { Infinity as InfinityIcon, UserCog } from "lucide-react";
import { useCredits } from "@/hooks/useCredits";
import { cn } from "@/lib/utils";

interface CreditPillProps {
  className?: string;
  compact?: boolean;
}

export const CreditPill = ({ className, compact }: CreditPillProps) => {
  const navigate = useNavigate();
  const {
    planMeta,
    isAdmin,
    includedCreditsRemaining,
    includedCreditsTotal,
    topupCreditsRemaining,
    loading,
  } = useCredits();

  if (loading) return null;

  const primaryLabel = isAdmin ? "Admin" : planMeta.label;
  const tooltip = isAdmin
    ? "Admin — ללא הגבלה"
    : `${planMeta.label} · נכלל: ${includedCreditsRemaining}/${includedCreditsTotal} · טעינות: ${topupCreditsRemaining}`;

  return (
    <button
      onClick={() => navigate("/profile?tab=account")}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-right border border-border/60 bg-card hover:bg-muted/60 transition-colors group",
        className,
      )}
      title={tooltip}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:text-foreground transition-colors">
        {isAdmin ? <InfinityIcon className="w-3.5 h-3.5" /> : <UserCog className="w-3.5 h-3.5" />}
      </span>
      <span className="flex flex-col items-start leading-tight min-w-0 flex-1">
        <span className="text-xs font-semibold text-foreground truncate w-full">{primaryLabel}</span>
        {!compact && (
          <span className="text-[10px] text-muted-foreground">ניהול חשבון</span>
        )}
      </span>
    </button>
  );
};
