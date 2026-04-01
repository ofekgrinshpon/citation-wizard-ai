import { Button } from "@/components/ui/button";

export type BillPublicationType = "הכנסת" | "הממשלה" | "";

interface Props {
  onSelect: (billType: BillPublicationType) => void;
}

const OPTIONS: { value: BillPublicationType; label: string; desc: string }[] = [
  { value: "הממשלה", label: 'ה"ח הממשלה', desc: "הצעת חוק ממשלתית" },
  { value: "הכנסת", label: 'ה"ח הכנסת', desc: "הצעת חוק של חבר כנסת" },
  { value: "", label: 'ה"ח (ללא ציון)', desc: "ללא ציון סוג החוברת" },
];

export function BillTypeSelector({ onSelect }: Props) {
  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-card shadow-sm my-3"
      style={{ direction: "rtl" }}
    >
      <p className="text-sm font-medium text-foreground">
        📄 באיזו חוברת פורסמה הצעת החוק?
      </p>
      <p className="text-xs text-muted-foreground mb-1">
        בחר את סוג חוברת הצעות החוק שבה פורסמה ההצעה:
      </p>
      <div className="flex gap-2 flex-wrap">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.value || "empty"}
            variant="outline"
            size="sm"
            className="flex flex-col items-start gap-0.5 h-auto py-2 px-3 text-right"
            onClick={() => onSelect(opt.value)}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
