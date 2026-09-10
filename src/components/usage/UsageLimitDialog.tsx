import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TopupOptions } from "@/components/usage/TopupOptions";
import { useUsage, formatCountdown, formatDaysLeft } from "@/hooks/useUsage";

export type UsageBlockReason =
  | "short_window"
  | "plan_allowance"
  | "trial_exhausted"
  | "plan_expired";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-provided reason; falls back to the current account status. */
  blockReason?: UsageBlockReason | null;
  /** Server timestamps — never computed on the client. */
  windowResetAt?: string | null;
  planEndsAt?: string | null;
}

/**
 * Blocked-action modal. All timing is derived from server timestamps, so a
 * changed device clock cannot make usage look available.
 */
export const UsageLimitDialog = ({
  open,
  onOpenChange,
  blockReason,
  windowResetAt,
  planEndsAt,
}: Props) => {
  const navigate = useNavigate();
  const { status, serverNowMs, isTrial } = useUsage();

  const reason: UsageBlockReason =
    blockReason ??
    (isTrial ? "trial_exhausted" : status?.isExpired ? "plan_expired" : "short_window");

  const countdown = formatCountdown(windowResetAt ?? status?.windowResetAt ?? null, serverNowMs);
  const daysLeft = formatDaysLeft(planEndsAt ?? status?.planEndsAt ?? null, serverNowMs);
  const canTopup = status?.canPurchaseTopup ?? false;

  const goToPlans = () => {
    onOpenChange(false);
    navigate("/profile?tab=account");
  };

  if (reason === "trial_exhausted") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">סיימת את מכסת ההתנסות</DialogTitle>
            <DialogDescription className="text-right">
              אהבת את ReLex? בחר תוכנית כדי להמשיך במחקר.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {["שבוע", "חודש", "סמסטר"].map((name) => (
              <Button key={name} variant="outline" onClick={goToPlans}>
                {name}
              </Button>
            ))}
          </div>
          <DialogFooter className="sm:justify-start">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>סגירה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const isPeriodBlock = reason === "plan_allowance" || reason === "plan_expired";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">
            {isPeriodBlock ? "הגעת למכסת השימוש של התוכנית" : "הגעת למגבלת השימוש הנוכחית"}
          </DialogTitle>
          <DialogDescription className="text-right">
            {isPeriodBlock
              ? daysLeft !== null
                ? `התוכנית מסתיימת בעוד ${daysLeft} ימים.`
                : "התוכנית הנוכchית אינה כוללת מכסה פנויה."
              : countdown
                ? `השימוש הכלול בתוכנית יהיה זמין שוב בעוד ${countdown}.`
                : "השימוש הכלול בתוכנית יהיה זמין שוב בקרוב."}
          </DialogDescription>
        </DialogHeader>

        {canTopup && <TopupOptions compact />}

        <DialogFooter className="sm:justify-start gap-2">
          <Button onClick={goToPlans}>
            {isPeriodBlock ? "בחירת תוכנית" : "הוסף שימוש והמשך עכשיו"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {isPeriodBlock ? "סגירה" : "המתן לחידוש המכסה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
