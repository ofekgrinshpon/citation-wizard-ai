import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PLANS, type PlanId } from "@/lib/plans";
import { Coins, AlertTriangle } from "lucide-react";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  is_subscribed?: boolean;
  citation_count?: number;
  plan?: PlanId | string;
  included_credits_remaining?: number;
  included_credits_total?: number;
  topup_credits_remaining?: number;
  referral_code?: string | null;
  referred_by_user_id?: string | null;
}

interface UserUsage {
  spent: number;
  lastChargeAt: string | null;
  lastActivityAt: string | null;
}

interface LedgerRow {
  id: string;
  event_type: string;
  amount: number;
  reason: string | null;
  created_at: string;
  balance_after_included: number;
  balance_after_topup: number;
}

interface UsersTableProps {
  users: UserProfile[];
  usage?: Record<string, UserUsage>;
  adminUserIds?: Set<string>;
  onUserUpdated?: (userId: string, patch: Partial<UserProfile>) => void;
}

const PLAN_OPTIONS: PlanId[] = ["basic", "pro_monthly", "pro_semester", "pro_annual", "admin"];

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";

const UsersTable = ({ users, usage = {}, adminUserIds, onUserUpdated }: UsersTableProps) => {
  const [search, setSearch] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [topupDrafts, setTopupDrafts] = useState<Record<string, string>>({});
  const [ledgerUser, setLedgerUser] = useState<UserProfile | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Build a quick lookup for "referred by" rendering
  const userById = new Map(users.map((u) => [u.id, u]));

  const openLedger = async (u: UserProfile) => {
    setLedgerUser(u);
    setLedgerLoading(true);
    setLedgerRows([]);
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("id, event_type, amount, reason, created_at, balance_after_included, balance_after_topup")
      .eq("user_id", u.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setLedgerLoading(false);
    if (error) {
      toast.error("שגיאה בטעינת תנועות: " + error.message);
      return;
    }
    setLedgerRows((data ?? []) as LedgerRow[]);
  };

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.full_name?.toLowerCase().includes(q) ||
      u.referral_code?.toLowerCase().includes(q)
    );
  });


  const handlePlanChange = async (userId: string, newPlan: PlanId) => {
    setBusyUserId(userId);
    const { data, error } = await supabase.rpc("set_user_plan", {
      _user_id: userId,
      _new_plan: newPlan,
    });
    setBusyUserId(null);
    if (error) {
      toast.error("שגיאה בעדכון תכנית: " + error.message);
      return;
    }
    const r = (data ?? {}) as { ok?: boolean; error?: string; remaining_included?: number };
    if (!r.ok) {
      toast.error("שגיאה: " + (r.error ?? "unknown"));
      return;
    }
    toast.success(`התכנית עודכנה ל-${PLANS[newPlan].label}`);
    onUserUpdated?.(userId, {
      plan: newPlan,
      included_credits_remaining: r.remaining_included,
      is_subscribed: newPlan !== "basic",
    });
  };

  const handleTopup = async (userId: string) => {
    const raw = topupDrafts[userId];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("הזן מספר חיובי");
      return;
    }
    setBusyUserId(userId);
    const { data, error } = await supabase.rpc("add_topup_credits", {
      _user_id: userId,
      _amount: amount,
      _reason: "admin top-up",
    });
    setBusyUserId(null);
    if (error) {
      toast.error("שגיאה: " + error.message);
      return;
    }
    const r = (data ?? {}) as { ok?: boolean; error?: string; remaining_topup?: number };
    if (!r.ok) {
      toast.error("שגיאה: " + (r.error ?? "unknown"));
      return;
    }
    toast.success(`נוספו ${amount} קרדיטים`);
    setTopupDrafts((prev) => ({ ...prev, [userId]: "" }));
    onUserUpdated?.(userId, { topup_credits_remaining: r.remaining_topup });
  };

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חפש לפי אימייל, שם או קוד הזמנה..."
        className="max-w-sm"
        dir="rtl"
      />
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">משתמש</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תכנית</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">קרדיטים</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">שימוש אחרון / חיוב אחרון</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">הוסף Top-up</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">קוד הזמנה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">הוזמן ע"י</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך הצטרפות</th>

              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    אין משתמשים תואמים
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const referrer = u.referred_by_user_id ? userById.get(u.referred_by_user_id) : null;
                  const planValue = (u.plan ?? "basic") as PlanId;
                  return (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors align-top">
                      <td className="px-4 py-3">
                        <div className="text-foreground">{u.email || "—"}</div>
                        {u.full_name && <div className="text-xs text-muted-foreground">{u.full_name}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={planValue}
                          onValueChange={(v) => handlePlanChange(u.id, v as PlanId)}
                          disabled={busyUserId === u.id}
                          dir="rtl"
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PLAN_OPTIONS.map((p) => (
                              <SelectItem key={p} value={p} className="text-xs">
                                {PLANS[p].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground">
                            {u.included_credits_remaining ?? 0}
                            <span className="text-muted-foreground"> כלולים</span>
                          </span>
                          <span className="text-foreground flex items-center gap-1">
                            <Coins className="w-3 h-3 text-primary" />
                            {u.topup_credits_remaining ?? 0}
                            <span className="text-muted-foreground">Top-up</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Input
                            type="number"
                            min={1}
                            value={topupDrafts[u.id] ?? ""}
                            onChange={(e) =>
                              setTopupDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            placeholder="0"
                            className="h-8 w-16 text-xs"
                            dir="ltr"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            disabled={busyUserId === u.id}
                            onClick={() => handleTopup(u.id)}
                          >
                            הוסף
                          </Button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.referral_code ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {u.referral_code}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {referrer ? (
                          <span className="text-foreground">{referrer.email ?? referrer.id.slice(0, 8)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString("he-IL")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersTable;
