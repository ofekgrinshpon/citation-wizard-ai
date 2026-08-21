// Single source of truth for plan metadata (UI + cost tables).
// Backend uses _plan_credits / _plan_reset_mode / _plan_period_length helpers.

export type PlanId = "basic" | "pro_monthly" | "pro_semester" | "pro_annual" | "admin";

export interface PlanMeta {
  id: PlanId;
  label: string;
  shortLabel: string;
  priceLabel: string;
  includedCredits: number;
  resetMode: "calendar_month" | "billing_period" | "period_bucket" | "none";
  allowsTopup: boolean;
  tagline: string;
}

export const PLANS: Record<PlanId, PlanMeta> = {
  basic: {
    id: "basic",
    label: "Basic",
    shortLabel: "Basic",
    priceLabel: "חינם",
    includedCredits: 10,
    resetMode: "calendar_month",
    allowsTopup: false,
    tagline: "להתנסות ולשימוש קל",
  },
  pro_monthly: {
    id: "pro_monthly",
    label: "Pro חודשי",
    shortLabel: "Pro",
    priceLabel: "29 ₪ לחודש",
    includedCredits: 250,
    resetMode: "billing_period",
    allowsTopup: true,
    tagline: "לעבודה שוטפת",
  },
  pro_semester: {
    id: "pro_semester",
    label: "Pro סמסטריאלי",
    shortLabel: "Pro Sem",
    priceLabel: "80 ₪ ל־3 חודשים",
    includedCredits: 900,
    resetMode: "period_bucket",
    allowsTopup: true,
    tagline: "אידיאלי לסמסטר — 3 חודשים",
  },
  pro_annual: {
    id: "pro_annual",
    label: "Pro שנתי",
    shortLabel: "Pro Yr",
    priceLabel: "199 ₪ לשנה",
    includedCredits: 3000,
    resetMode: "period_bucket",
    allowsTopup: true,
    tagline: "הערך הטוב ביותר למשתמשים קבועים",
  },
  admin: {
    id: "admin",
    label: "Admin",
    shortLabel: "Admin",
    priceLabel: "—",
    includedCredits: 0,
    resetMode: "none",
    allowsTopup: false,
    tagline: "ללא הגבלה",
  },
};

export const TOPUP_PACKS = [
  { credits: 100, priceLabel: "15 ₪" },
  { credits: 500, priceLabel: "49 ₪" },
  { credits: 2000, priceLabel: "149 ₪" },
] as const;

export function isPaidPlan(plan: PlanId) {
  return plan === "pro_monthly" || plan === "pro_semester" || plan === "pro_annual";
}
