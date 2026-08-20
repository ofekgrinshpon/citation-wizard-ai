import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RANGE_OPTIONS, FEATURES, type RangeKey, type FeatureKey } from "@/hooks/useUsageStats";

export type Outcome = "answered" | "refused" | "stub";

export interface UserAction {
  at: string;
  feature: FeatureKey;
  label: string;
  text: string;
  outcome: Outcome;
  credits: number;
}

export interface UserFeatureStat {
  key: FeatureKey;
  label: string;
  actions: number;
  credits: number;
  answered: number;
  refused: number;
  stub: number;
}

export interface UserDay {
  date: string;
  count: number;
}

export interface UserUsage {
  profile: {
    id: string;
    name: string;
    email: string;
    plan: string;
    includedRemaining: number;
    topupRemaining: number;
    createdAt: string | null;
  } | null;
  totalActions: number;
  creditsSpent: number;
  creditsRefunded: number;
  byFeature: UserFeatureStat[];
  daily: UserDay[];
  actions: UserAction[];
}

const EMPTY: UserUsage = {
  profile: null,
  totalActions: 0,
  creditsSpent: 0,
  creditsRefunded: 0,
  byFeature: [],
  daily: [],
  actions: [],
};

const LABEL = Object.fromEntries(FEATURES.map((f) => [f.key, f.label])) as Record<FeatureKey, string>;

function featureFromTaskMode(mode: string | null): FeatureKey {
  switch (mode) {
    case "legal_research_v1":
    case "legal_source_search":
      return "research";
    case "research":
      return "qa";
    case "academic_writing":
      return "academic";
    case "case_summary":
    case "pleading_analysis":
    case "argument_draft":
      return "documents";
    default:
      return "other";
  }
}

function outcomeOf(answer: string | null): Outcome {
  const a = (answer ?? "").trim();
  if (!a) return "refused";
  if (a.startsWith("[stub]")) return "stub";
  if (/^(לא נמצא|לא אותר|לא ניתן|אין די|לא הצלחתי)/.test(a)) return "refused";
  return "answered";
}

/** Per-user usage breakdown for the admin statistics drill-down. */
export function useUserUsage(userId: string | null, range: RangeKey) {
  const [usage, setUsage] = useState<UserUsage>(EMPTY);
  const [loading, setLoading] = useState(false);

  const since = useMemo(() => {
    const days = RANGE_OPTIONS.find((r) => r.id === range)?.days ?? null;
    return days === null ? null : new Date(Date.now() - days * 86400000).toISOString();
  }, [range]);

  const fetchUsage = useCallback(async () => {
    if (!userId) {
      setUsage(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const bound = <T,>(q: T): T => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = q as any;
        return (since ? query.gte("created_at", since) : query) as T;
      };

      const [profileRes, citRes, qaRes, ledgerRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, email, full_name, plan, created_at, included_credits_remaining, topup_credits_remaining",
          )
          .eq("id", userId)
          .maybeSingle(),
        bound(
          supabase
            .from("citation_history")
            .select("raw_input, formatted_output, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(500),
        ),
        bound(
          supabase
            .from("qa_logs")
            .select("question, answer, task_mode, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(500),
        ),
        bound(
          supabase
            .from("credit_ledger")
            .select("event_type, amount, reason, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1000),
        ),
      ]);

      const actions: UserAction[] = [];

      for (const row of (citRes.data ?? []) as {
        raw_input: string;
        formatted_output: string | null;
        created_at: string;
      }[]) {
        actions.push({
          at: row.created_at,
          feature: "citation",
          label: LABEL.citation,
          text: row.raw_input,
          outcome: row.formatted_output ? "answered" : "refused",
          credits: 0,
        });
      }

      for (const row of (qaRes.data ?? []) as {
        question: string;
        answer: string | null;
        task_mode: string | null;
        created_at: string;
      }[]) {
        const feature = featureFromTaskMode(row.task_mode);
        actions.push({
          at: row.created_at,
          feature,
          label: LABEL[feature],
          text: row.question,
          outcome: outcomeOf(row.answer),
          credits: 0,
        });
      }

      const ledger = (ledgerRes.data ?? []) as {
        event_type: string;
        amount: number;
        reason: string | null;
        created_at: string;
      }[];

      let creditsSpent = 0;
      let creditsRefunded = 0;
      const creditsByFeature = new Map<FeatureKey, number>();
      for (const row of ledger) {
        const reason = row.reason ?? "";
        let feature: FeatureKey = "other";
        if (reason.startsWith("citation-chat") || reason.startsWith("legacy:")) feature = "citation";
        else if (reason.startsWith("bibliography-lookup")) feature = "bibliography";
        else if (reason.startsWith("legal-research-v1")) feature = "research";
        else if (reason.startsWith("legal-qa:academic_writing")) feature = "academic";
        else if (reason.startsWith("legal-qa:research")) feature = "qa";
        else if (reason.startsWith("legal-qa:") || reason.startsWith("document-check")) feature = "documents";

        if (row.event_type === "consume") {
          const spent = Math.max(0, -(row.amount ?? 0));
          creditsSpent += spent;
          creditsByFeature.set(feature, (creditsByFeature.get(feature) ?? 0) + spent);
          if (feature === "bibliography") {
            actions.push({
              at: row.created_at,
              feature,
              label: LABEL.bibliography,
              text: reason,
              outcome: "answered",
              credits: spent,
            });
          }
        } else if (row.event_type === "refund") {
          creditsRefunded += Math.max(0, row.amount ?? 0);
        }
      }

      actions.sort((a, b) => b.at.localeCompare(a.at));

      const statMap = new Map<FeatureKey, UserFeatureStat>();
      const dayMap = new Map<string, number>();
      for (const a of actions) {
        const stat =
          statMap.get(a.feature) ??
          ({
            key: a.feature,
            label: a.label,
            actions: 0,
            credits: 0,
            answered: 0,
            refused: 0,
            stub: 0,
          } as UserFeatureStat);
        stat.actions += 1;
        stat[a.outcome] += 1;
        statMap.set(a.feature, stat);
        const key = a.at.slice(0, 10);
        dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
      }
      for (const [feature, credits] of creditsByFeature) {
        const stat = statMap.get(feature);
        if (stat) stat.credits = credits;
      }

      const p = profileRes.data as {
        id: string;
        email: string | null;
        full_name: string | null;
        plan: string | null;
        created_at: string;
        included_credits_remaining: number | null;
        topup_credits_remaining: number | null;
      } | null;

      setUsage({
        profile: p
          ? {
              id: p.id,
              name: p.full_name || p.email || p.id.slice(0, 8),
              email: p.email || "",
              plan: p.plan || "basic",
              includedRemaining: p.included_credits_remaining ?? 0,
              topupRemaining: p.topup_credits_remaining ?? 0,
              createdAt: p.created_at,
            }
          : null,
        totalActions: actions.length,
        creditsSpent,
        creditsRefunded,
        byFeature: [...statMap.values()].sort((a, b) => b.actions - a.actions),
        daily: [...dayMap.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        actions: actions.slice(0, 50),
      });
    } catch (err) {
      console.error("[Admin] useUserUsage failed:", err);
    } finally {
      setLoading(false);
    }
  }, [userId, since]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  return { usage, loading, refresh: fetchUsage };
}
