// Deprecated shim — kept so existing call sites keep working while the usage
// UX migrates. Renders the new usage-limit modal; no raw balances are shown.
import { UsageLimitDialog, type UsageBlockReason } from "@/components/usage/UsageLimitDialog";

interface InsufficientCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ignored — internal unit amounts are never shown to users. */
  required?: number;
  remaining?: number;
  blockReason?: UsageBlockReason | null;
  windowResetAt?: string | null;
  planEndsAt?: string | null;
}

export const InsufficientCreditsDialog = ({
  open,
  onOpenChange,
  blockReason,
  windowResetAt,
  planEndsAt,
}: InsufficientCreditsDialogProps) => (
  <UsageLimitDialog
    open={open}
    onOpenChange={onOpenChange}
    blockReason={blockReason ?? null}
    windowResetAt={windowResetAt ?? null}
    planEndsAt={planEndsAt ?? null}
  />
);
