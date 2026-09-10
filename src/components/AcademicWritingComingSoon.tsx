import { GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown when a user clicks the Academic Writing entry while the feature is
 * disabled. Presentation only — it never initializes a session, never calls a
 * research endpoint, and never charges credits.
 */
export function AcademicWritingComingSoon({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" style={{ direction: "rtl" }}>
        <DialogHeader className="items-center text-center gap-2">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <GraduationCap className="w-5 h-5 text-primary" />
          </span>
          <DialogTitle className="text-base">כתיבה אקדמית — בקרוב</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            אנחנו עובדים על עוזר כתיבה אקדמית שילווה אותך משאלת המחקר ועד לכתיבת
            העבודה, שלב אחר שלב. היכולת עדיין בפיתוח ותיפתח בהמשך.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground text-center">
          בינתיים אפשר להשתמש במחקר משפטי, אזכור אחיד, הערות שוליים וביבליוגרפיה.
        </p>
      </DialogContent>
    </Dialog>
  );
}
