import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useCreditLedger, type LedgerRow } from "@/hooks/useCreditLedger";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { PLANS, TOPUP_PACKS } from "@/lib/plans";
import { buildReferralLink } from "@/lib/publicUrl";
import { Copy as CopyIcon, Infinity as InfinityIcon } from "lucide-react";

interface ActivityLog {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  project_id: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  consume: "שימוש בקרדיטים",
  refund: "החזר אוטומטי",
  topup: "טעינת חבילה",
  renewal: "חידוש מסלול",
  admin_adjustment: "התאמה ידנית",
  referral_bonus: "בונוס הזמנה",
  signup_bonus: "בונוס הצטרפות",
};

const PLAN_LABELS_HE: Record<string, string> = {
  basic: "Basic",
  pro_monthly: "Pro חודשי",
  pro_semester: "Pro סמסטריאלי",
  pro_annual: "Pro שנתי",
  admin: "Admin",
};

/** Translate a raw ledger reason (English technical string) into Hebrew for display. */
function formatLedgerReason(raw: string | null): string {
  if (!raw) return "";
  const r = raw.trim();

  const direct: Record<string, string> = {
    "citation-chat": "אזכור אחיד",
    "legacy:incrementCount": "אזכור אחיד",
    "verified-autocomplete": "השלמה אוטומטית מאומתת",
    "batch-footnote": "מחולל הערות שוליים",
    "bibliography": "מחולל ביבליוגרפיה",
    "academic-writing": "כתיבה אקדמית",
    "invalid_input_refusal": "הקלט לא היה ברור דיו",
    "runtime-error": "שגיאה טכנית",
    "citation-chat exception": "שגיאה טכנית באזכור אחיד",
    "manual": "התאמה ידנית",
  };
  if (direct[r]) return direct[r];

  const qa = r.match(/^legal-qa:([a-z_]+)(\+doc)?$/i);
  if (qa) {
    const modes: Record<string, string> = {
      research: "עוזר משפטי – מחקר",
      legal_source_search: "עוזר משפטי – חיפוש מקורות",
      case_summary: "עוזר משפטי – סיכום פסק דין",
      academic_writing: "עוזר משפטי – כתיבה אקדמית",
    };
    const base = modes[qa[1]] ?? `עוזר משפטי – ${qa[1]}`;
    return qa[2] ? `${base} (עם מסמך מצורף)` : base;
  }

  const auto = r.match(/^auto-refund:\s*(.+)$/i);
  if (auto) return `החזר אוטומטי – ${formatLedgerReason(auto[1])}`;

  const plan = r.match(/^plan changed to\s+(\S+)/i);
  if (plan) return `שינוי מסלול ל-${PLAN_LABELS_HE[plan[1]] ?? plan[1]}`;

  if (/[\u0590-\u05FF]/.test(r)) return r;
  return "פעולת מערכת";
}


const Profile = () => {
  const { user, signOut } = useAuth();
  const {
    plan, planMeta, isAdmin, isPaidPlan, canTopup,
    includedCreditsRemaining, includedCreditsTotal, topupCreditsRemaining,
    totalCreditsAvailable, billingPeriodEndsAt, referralCode,
  } = useCredits();
  const { rows: ledger, loading: ledgerLoading } = useCreditLedger(50);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "profile";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [referralsGranted, setReferralsGranted] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    loadProfile();
    loadActivity();
    loadCitations();
    loadReferralCount();
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles").select("full_name, email").eq("id", user.id).single();
    if (data) {
      setFullName(data.full_name || "");
      setEmail(data.email || user.email || "");
    }
    setLoading(false);
  };

  const loadActivity = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("activity_logs").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(100);
    setActivities((data as ActivityLog[]) || []);
  };

  const loadCitations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("citation_history").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(200);
    setCitations(data || []);
  };

  const loadReferralCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from("profiles").select("id", { count: "exact", head: true })
      .eq("referred_by_user_id", user.id).eq("referral_bonus_granted", true);
    setReferralsGranted(count ?? 0);
  };

  const updateProfile = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    if (error) toast.error("שגיאה בשמירה");
    else toast.success("הפרופיל עודכן");
  };

  const filteredCitations = citations.filter((c) =>
    !searchQuery || c.raw_input?.includes(searchQuery) || c.formatted_output?.includes(searchQuery)
  );

  const referralLink = buildReferralLink(referralCode);

  const copyReferralLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    toast.success("הקישור הועתק");
  };

  const includedRatio = includedCreditsTotal > 0 ? includedCreditsRemaining / includedCreditsTotal : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <header className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-2xl sm:text-3xl">👤</div>
          <h1 className="text-foreground text-base sm:text-lg font-bold">הפרופיל שלי</h1>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          <button onClick={() => navigate("/app")} className="text-[10px] sm:text-xs text-primary hover:bg-primary/10 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg transition-colors">← חזרה</button>
          <button onClick={async () => { await signOut(); navigate("/"); }} className="text-[10px] sm:text-xs text-destructive hover:bg-destructive/10 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg transition-colors">התנתק</button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-3 sm:p-6">
        <Tabs defaultValue={defaultTab} dir="rtl">
          <TabsList className="w-full justify-start mb-4 sm:mb-6 overflow-x-auto no-scrollbar">
            <TabsTrigger value="profile" className="text-xs sm:text-sm">פרטים אישיים</TabsTrigger>
            <TabsTrigger value="account" className="text-xs sm:text-sm">ניהול חשבון</TabsTrigger>
            <TabsTrigger value="referral" className="text-xs sm:text-sm">הזמן חברים</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm">היסטוריית אזכורים</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs sm:text-sm">יומן פעילות</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">שם מלא</label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">אימייל</label>
                <Input value={email} disabled dir="ltr" />
              </div>
              <button onClick={updateProfile} className="px-6 py-2.5 rounded-xl font-semibold text-sm text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
                שמור שינויים
              </button>
            </div>
          </TabsContent>

          <TabsContent value="account">
            <div className="space-y-4">
              {/* Plan card */}
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-foreground font-bold text-base">התוכנית שלי</h3>
                    <Badge variant={usage?.isPaid ? "default" : "secondary"}>{usagePlanMeta.label}</Badge>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUsageInfoOpen(true)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    איך מגבלות השימוש עובדות?
                  </button>
                </div>

                {isAdmin ? (
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <InfinityIcon className="w-4 h-4 text-primary" />
                    שימוש ללא הגבלה
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Current 5-hour window */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">מכסת שימוש נוכחית</span>
                        <span className="font-semibold text-foreground">
                          {WINDOW_LEVEL_LABEL[usage?.windowLevel ?? "low"]}
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (usage?.windowRatio ?? 0) * 100)}%`,
                            background:
                              (usage?.windowRatio ?? 0) >= 0.85
                                ? "hsl(var(--destructive))"
                                : "var(--gradient-primary)",
                          }}
                        />
                      </div>
                      {windowCountdown && (
                        <p className="text-xs text-muted-foreground">מתחדשת בעוד {windowCountdown}</p>
                      )}
                    </div>

                    {/* Plan period allowance */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">מכסת התוכנית</span>
                        <span className="font-semibold text-foreground">
                          {PERIOD_LEVEL_LABEL[usage?.periodLevel ?? "low"]}
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (usage?.periodRatio ?? 0) * 100)}%`,
                            background:
                              (usage?.periodRatio ?? 0) >= 0.85
                                ? "hsl(var(--destructive))"
                                : "var(--gradient-primary)",
                          }}
                        />
                      </div>
                      {usage?.planEndsAt ? (
                        <p className="text-xs text-muted-foreground">
                          התוכנית מסתיימת בעוד {planDaysLeft} ימים ({format(new Date(usage.planEndsAt), "dd/MM/yyyy")})
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          מכסת ההתנסות היא חד־פעמית ואינה מתחדשת.
                        </p>
                      )}
                    </div>

                    {usage?.hasExtraUsage && (
                      <p className="text-xs text-primary">יש בחשבונך תוספת שימוש זמינה.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Plan options */}
              {!isAdmin && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h4 className="text-sm font-bold text-foreground mb-3">תוכניות זמינות</h4>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {(["week", "month", "semester"] as const).map((id) => {
                      const p = PLANS[id];
                      return (
                        <button
                          key={id}
                          onClick={() => toast.info("רכישת תוכנית תיפתח בקרוב")}
                          className="border border-border rounded-lg p-3 text-right hover:border-primary/50 transition-colors"
                        >
                          <div className="font-semibold text-foreground text-sm">{p.label}</div>
                          <div className="text-xs text-primary mt-0.5">{p.priceLabel}</div>
                          <div className="text-xs text-muted-foreground mt-1">{p.durationLabel}</div>
                          <p className="text-[11px] text-muted-foreground mt-2">{p.tagline}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-3">
                    התוכניות הן לתקופה קצובה וללא חידוש אוטומטי. השימוש כפוף למכסה קצרת טווח
                    המתחדשת כל 5 שעות ולמכסה כוללת לתקופה.
                  </p>
                </div>
              )}

              {/* Usage add-ons */}
              {!isAdmin && (usage?.canPurchaseTopup ?? false) && (
                <div className="bg-card border border-border rounded-xl p-6 space-y-3">
                  <h4 className="text-sm font-bold text-foreground">תוספת שימוש</h4>
                  <TopupOptions />
                </div>
              )}

              {/* Activity history — no raw balances */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h4 className="text-sm font-bold text-foreground mb-3">היסטוריית שימוש</h4>
                {ledgerLoading ? (
                  <p className="text-xs text-muted-foreground">טוען...</p>
                ) : ledger.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">אין פעולות עדיין</p>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {ledger.map((row: LedgerRow) => {
                      const isRefund = row.event_type === "refund";
                      return (
                        <div key={row.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 text-xs">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{EVENT_LABEL[row.event_type] || row.event_type}</span>
                              {isRefund && <Badge variant="outline" className="text-[10px] px-1 py-0 text-emerald-600 border-emerald-600/40">הוחזר</Badge>}
                            </div>
                            {row.reason && (
                              <div className="text-muted-foreground truncate" title={row.reason}>
                                {formatLedgerReason(row.reason)}
                              </div>
                            )}
                            <div className="text-muted-foreground">{format(new Date(row.created_at), "dd/MM/yyyy HH:mm")}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <UsageLimitsInfoDialog open={usageInfoOpen} onOpenChange={setUsageInfoOpen} />
          </TabsContent>

          <TabsContent value="referral">
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div>
                <h3 className="text-foreground font-bold text-base mb-1">הזמן חברים ל-ReLex</h3>
                <p className="text-sm text-muted-foreground">
                  הזמן חברים ל-ReLex, וכשחבר חדש נרשם דרך הקישור שלך ומבצע את הפעולה הראשונה — שניכם מקבלים 10 קרדיטים.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">קוד ההזמנה שלך</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-muted rounded-lg font-mono text-sm text-foreground tracking-wider text-center">
                    {referralCode || "—"}
                  </code>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">הקישור האישי שלך</label>
                <div className="flex items-center gap-2">
                  <Input value={referralLink} readOnly dir="ltr" className="text-xs" />
                  <button
                    onClick={copyReferralLink}
                    disabled={!referralLink}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                  >
                    <CopyIcon className="w-3.5 h-3.5" /> העתק
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">חברים שהצטרפו וזכו בבונוס</span>
                <span className="font-bold text-primary tabular-nums">{referralsGranted}</span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-4">
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="חפש באזכורים..." />
              {filteredCitations.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">אין אזכורים עדיין</p>
              ) : (
                <div className="space-y-2">
                  {filteredCitations.map((c) => (
                    <div key={c.id} className="bg-card border border-border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        {format(new Date(c.created_at), "dd/MM/yyyy HH:mm")}
                        {c.source_type && <span className="mr-2 text-primary">• {c.source_type}</span>}
                      </div>
                      <p className="text-sm text-foreground">{c.formatted_output}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity">
            {activities.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">אין פעילות עדיין</p>
            ) : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 bg-card border border-border rounded-lg p-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground font-medium">{a.action}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(a.created_at), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Profile;
