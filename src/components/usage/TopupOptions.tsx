import { toast } from "sonner";
import { TOPUP_PACKS, TOPUP_DISCLOSURE } from "@/lib/plans";

interface Props {
  /** Disable purchase (e.g. free-trial users must pick a plan first). */
  disabled?: boolean;
  compact?: boolean;
}

/** "תוספת שימוש" options. Checkout is not wired yet — no payment is charged. */
export const TopupOptions = ({ disabled, compact }: Props) => (
  <div className="space-y-3">
    <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-3"}>
      {TOPUP_PACKS.map((pack) => (
        <button
          key={pack.id}
          type="button"
          disabled={disabled}
          onClick={() =>
            toast.info("רכישת תוספת שימוש תיפתח בקרוב", {
              description: "נעדכן אתכם ברגע שהתשלום יופעל בבטא.",
            })
          }
          className="rounded-xl border border-border bg-card p-3 text-right transition-colors hover:border-primary/50 disabled:opacity-50 disabled:hover:border-border"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-foreground">{pack.label}</span>
            <span className="text-sm font-bold text-primary">{pack.priceLabel}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{pack.description}</p>
        </button>
      ))}
    </div>
    <p className="text-[11px] text-muted-foreground">{TOPUP_DISCLOSURE}</p>
  </div>
);
