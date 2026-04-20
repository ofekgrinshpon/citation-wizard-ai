import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/useCredits";

interface InsufficientCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  required: number;
  remaining?: number;
}

export const InsufficientCreditsDialog = ({
  open,
  onOpenChange,
  required,
  remaining,
}: InsufficientCreditsDialogProps) => {
  const navigate = useNavigate();
  const { isPaidPlan, totalCreditsAvailable } = useCredits();
  const left = remaining ?? totalCreditsAvailable;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">אין מספיק קרדיטים</DialogTitle>
          <DialogDescription className="text-right">
            נותרו לך <strong>{left}</strong> קרדיטים, אך הפעולה הזו דורשת <strong>{required}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-start gap-2">
          <Button
            onClick={() => {
              onOpenChange(false);
              navigate("/profile?tab=account");
            }}
          >
            {isPaidPlan ? "טען חבילה" : "שדרג ל-Pro"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
