import { useState } from "react";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const SOURCE_CATEGORIES: { key: SourceType; label: string; icon: string }[] = [
  { key: "case_law_published", label: "פסיקה (דפוס)", icon: "⚖️" },
  { key: "case_law_database", label: "פסיקה (מאגר)", icon: "⚖️" },
  { key: "primary_legislation", label: "חקיקה ראשית", icon: "📜" },
  { key: "basic_law", label: "חוק יסוד", icon: "📜" },
  { key: "secondary_legislation", label: "חקיקת משנה", icon: "📜" },
  { key: "bill", label: "הצעת חוק", icon: "📄" },
  { key: "book", label: "ספר", icon: "📕" },
  { key: "article", label: "מאמר בכתב עת", icon: "📰" },
  { key: "article_in_book", label: "מאמר שפורסם בספר", icon: "📖" },
  { key: "internet", label: "מקור מרשתת", icon: "🌐" },
  { key: "treaty", label: "כתבי אמנה", icon: "🤝" },
  { key: "religious", label: "מקור דתי", icon: "📿" },
  { key: "foreign", label: "מקור לועזי", icon: "🌍" },
  { key: "other", label: "אחר (דברי כנסת וכו׳)", icon: "📁" },
];

interface Props {
  detectedType: SourceType;
  onChangeType: (newType: SourceType) => void;
}

export function SourceTypeConfirmation({ detectedType, onChangeType }: Props) {
  const [open, setOpen] = useState(false);
  const label = SOURCE_TYPE_LABELS[detectedType] || "לא מזוהה";

  return (
    <div
      className="flex items-center gap-2 flex-wrap mb-2 py-2 px-3 rounded-lg border border-border bg-muted/50"
      style={{ direction: "rtl" }}
    >
      <span className="text-xs text-muted-foreground">
        המערכת זיהתה כי מדובר ב<strong className="text-foreground">{label}</strong>.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="text-xs h-7 px-2.5"
        onClick={() => setOpen(true)}
      >
        שינוי מקור
      </Button>
      <span className="text-[10px] text-muted-foreground">
        במידה ולא, לחץ על &lsquo;שינוי מקור&rsquo; כדי לבחור קטגוריה אחרת.
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" style={{ direction: "rtl" }}>
          <DialogHeader>
            <DialogTitle className="text-right">בחר סוג מקור</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5 max-h-[60vh] overflow-y-auto py-2">
            {SOURCE_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => {
                  onChangeType(cat.key);
                  setOpen(false);
                }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm text-right transition-colors ${
                  cat.key === detectedType
                    ? "bg-primary/10 text-primary font-medium border border-primary/20"
                    : "hover:bg-accent text-foreground"
                }`}
              >
                <span className="text-base">{cat.icon}</span>
                <span>{cat.label}</span>
                {cat.key === detectedType && (
                  <span className="mr-auto text-[10px] text-primary">✓ נוכחי</span>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
