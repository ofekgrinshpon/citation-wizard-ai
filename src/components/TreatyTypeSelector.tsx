import { Button } from "@/components/ui/button";

export type TreatySigningType = "multilateral" | "bilateral";

interface Props {
  onSelect: (type: TreatySigningType) => void;
}

const OPTIONS: { value: TreatySigningType; label: string; desc: string }[] = [
  { value: "multilateral", label: "רב-צדדית", desc: 'נפתחה לחתימה ב-...' },
  { value: "bilateral", label: "דו-צדדית", desc: 'נחתמה ב-...' },
];

export function TreatyTypeSelector({ onSelect }: Props) {
  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-card shadow-sm my-3"
      style={{ direction: "rtl" }}
    >
      <p className="text-sm font-medium text-foreground">
        🤝 האם מדובר באמנה רב-צדדית או דו-צדדית?
      </p>
      <p className="text-xs text-muted-foreground mb-1">
        אמנה רב-צדדית – &quot;נפתחה לחתימה ב-...&quot; | אמנה דו-צדדית – &quot;נחתמה ב-...&quot; (כלל 9.1)
      </p>
      <div className="flex gap-2 flex-wrap">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.value}
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