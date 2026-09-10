// Single source of truth for plan metadata (public UX + internal accounting).
// Backend uses _plan_credits / _plan_window_limit / _plan_reset_mode / _plan_period_length.
//
// PRODUCT RULE: `includedUnits` / `windowUnits` are INTERNAL accounting values.
// They must never be rendered to a normal user. Public surfaces speak about
// "מכסת שימוש" only.

export type PlanId =
  | "trial"
  | "week"
  | "month"
  | "semester"
  // legacy plans preserved for existing accounts
  | "basic"
  | "pro_monthly"
  | "pro_semester"
  | "pro_annual"
  | "admin";

export interface PlanMeta {
  id: PlanId;
  /** User-facing plan name. */
  label: string;
  shortLabel: string;
  priceLabel: string;
  /** Public duration wording, empty for trial/admin. */
  durationLabel: string;
  /** INTERNAL — total usage units for the period. Never render. */
  includedUnits: number;
  /** INTERNAL — usage units per rolling 5-hour window. Never render. */
  windowUnits: number;
  resetMode: "calendar_month" | "billing_period" | "period_bucket" | "fixed_term" | "none";
  allowsTopup: boolean;
  tagline: string;
  /** Legacy plans are never offered for new purchase. */
  legacy: boolean;
}

export const PLANS: Record<PlanId, PlanMeta> = {
  trial: {
    id: "trial",
    label: "התנסות חינם",
    shortLabel: "התנסות",
    priceLabel: "₪0",
    durationLabel: "עד לניצול מכסת ההתנסות",
    includedUnits: 15,
    windowUnits: 15,
    resetMode: "none",
    allowsTopup: false,
    tagline: "נסו את כלי המחקר של ReLex ללא תשלום וללא התחייבות.",
    legacy: false,
  },
  week: {
    id: "week",
    label: "שבוע",
    shortLabel: "שבוע",
    priceLabel: "₪29",
    durationLabel: "7 ימים",
    includedUnits: 45,
    windowUnits: 20,
    resetMode: "fixed_term",
    allowsTopup: true,
    tagline: "לעבודה, מטלה או שבוע לימודים אינטנסיבי",
    legacy: false,
  },
  month: {
    id: "month",
    label: "חודש",
    shortLabel: "חודש",
    priceLabel: "₪69",
    durationLabel: "30 ימים",
    includedUnits: 140,
    windowUnits: 25,
    resetMode: "fixed_term",
    allowsTopup: true,
    tagline: "לעבודה שוטפת לאורך החודש",
    legacy: false,
  },
  semester: {
    id: "semester",
    label: "סמסטר",
    shortLabel: "סמסטר",
    priceLabel: "₪169",
    durationLabel: "90 ימים",
    includedUnits: 360,
    windowUnits: 30,
    resetMode: "fixed_term",
    allowsTopup: true,
    tagline: "ללימודים ומחקר לאורך הסמסטר",
    legacy: false,
  },

  // ── Legacy plans (existing accounts only, never offered publicly) ──
  basic: {
    id: "basic",
    label: "Basic",
    shortLabel: "Basic",
    priceLabel: "—",
    durationLabel: "",
    includedUnits: 10,
    windowUnits: 15,
    resetMode: "calendar_month",
    allowsTopup: false,
    tagline: "תוכנית קודמת",
    legacy: true,
  },
  pro_monthly: {
    id: "pro_monthly",
    label: "Pro חודשי",
    shortLabel: "Pro",
    priceLabel: "—",
    durationLabel: "חודש",
    includedUnits: 250,
    windowUnits: 25,
    resetMode: "billing_period",
    allowsTopup: true,
    tagline: "תוכנית קודמת",
    legacy: true,
  },
  pro_semester: {
    id: "pro_semester",
    label: "Pro סמסטריאלי",
    shortLabel: "Pro Sem",
    priceLabel: "—",
    durationLabel: "3 חודשים",
    includedUnits: 900,
    windowUnits: 30,
    resetMode: "period_bucket",
    allowsTopup: true,
    tagline: "תוכנית קודמת",
    legacy: true,
  },
  pro_annual: {
    id: "pro_annual",
    label: "Pro שנתי",
    shortLabel: "Pro Yr",
    priceLabel: "—",
    durationLabel: "שנה",
    includedUnits: 3000,
    windowUnits: 30,
    resetMode: "period_bucket",
    allowsTopup: true,
    tagline: "תוכנית קודמת",
    legacy: true,
  },
  admin: {
    id: "admin",
    label: "Admin",
    shortLabel: "Admin",
    priceLabel: "—",
    durationLabel: "",
    includedUnits: 0,
    windowUnits: 0,
    resetMode: "none",
    allowsTopup: false,
    tagline: "ללא הגבלה",
    legacy: true,
  },
};

/** Plans offered publicly for new purchase, in display order. */
export const PUBLIC_PLAN_ORDER: PlanId[] = ["trial", "week", "month", "semester"];

/** Purchasable usage add-ons ("תוספת שימוש"). Unit values are internal. */
export const TOPUP_PACKS = [
  {
    id: "small" as const,
    label: "תוספת קטנה",
    priceLabel: "₪15",
    units: 20,
    description: "מתאימה לעד כ־4 מחקרים משפטיים מלאים, או ליותר פעולות קלות.",
  },
  {
    id: "medium" as const,
    label: "תוספת בינונית",
    priceLabel: "₪29",
    units: 45,
    description: "מתאימה לעד כ־9 מחקרים משפטיים מלאים, או ליותר פעולות קלות.",
  },
  {
    id: "large" as const,
    label: "תוספת גדולה",
    priceLabel: "₪49",
    units: 80,
    description: "מתאימה לעד כ־16 מחקרים משפטיים מלאים, או ליותר פעולות קלות.",
  },
];

export const TOPUP_DISCLOSURE =
  "תוספת שימוש שנרכשה נשמרת בחשבון עד לניצולה, וניתנת לשימוש במסגרת תוכנית ReLex פעילה.";

export function isPaidPlan(plan: PlanId) {
  return (
    plan === "week" ||
    plan === "month" ||
    plan === "semester" ||
    plan === "pro_monthly" ||
    plan === "pro_semester" ||
    plan === "pro_annual"
  );
}

/** Fixed-term plans end; they do not renew automatically. */
export function isFixedTerm(plan: PlanId) {
  return PLANS[plan]?.resetMode === "fixed_term";
}
