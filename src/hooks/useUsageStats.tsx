import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RangeKey = "7d" | "30d" | "90d" | "all";

export const RANGE_OPTIONS: { id: RangeKey; label: string; days: number | null }[] = [
  { id: "7d", label: "7 ימים", days: 7 },
  { id: "30d", label: "30 ימים", days: 30 },
  { id: "90d", label: "90 ימים", days: 90 },
  { id: "all", label: "מאז ומתמיד", days: null },
];

/** Feature families surfaced in the dashboard. */
export const FEATURES = [
  { key: "citation", label: "אשף האזכורים" },
  { key: "research", label: "מחקר משפטי" },
  { key: "qa", label: "שו״ת משפטי" },
  { key: "academic", label: "כתיבה אקדמית" },
  { key: "bibliography", label: "ביבליוגרפיה" },
  { key: "documents", label: "ניתוח מסמכים" },
  { key: "other", label: "אחר" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

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

function featureFromReason(reason: string | null): FeatureKey {
  const r = reason ?? "";
  if (r.startsWith("citation-chat") || r.startsWith("legacy:")) return "citation";
  if (r.startsWith("bibliography-lookup")) return "bibliography";
  if (r.startsWith("legal-research-v1")) return "research";
  if (r.startsWith("legal-qa:academic_writing")) return "academic";
  if (r.startsWith("legal-qa:research")) return "qa";
  if (r.startsWith("legal-qa:") || r.startsWith("document-check")) return "documents";
  return "other";
}

export interface FeatureStat {
  key: FeatureKey;
  label: string;
  actions: number;
  credits: number;
  users: number;
}

export interface DayPoint {
  date: string;
  total: number;
  citation: number;
  research: number;
  qa: number;
  academic: number;
  bibliography: number;
  documents: number;
  other: number;
}

export interface TopUser {
  id: string;
  name: string;
  plan: string;
  actions: number;
  credits: number;
}

export interface UsageStats {
  totalActions: number;
  prevTotalActions: number;
  activeUsers: number;
  prevActiveUsers: number;
  newSignups: number;
  prevNewSignups: number;
  creditsSpent: number;
  prevCreditsSpent: number;
  creditsRefunded: number;
  actionsPerActiveUser: number;
  prevActionsPerActiveUser: number;
  daily: DayPoint[];
  byFeature: FeatureStat[];
  topUsers: TopUser[];
  planCounts: { plan: string; count: number }[];
  neverActive: number;
  activeThisWeek: number;
  activeLastWeek: number;
  jobStatuses: { status: string; count: number }[];
  jobFailureRate: number;
  failedRequests: { code: string; count: number }[];
  refunds: { reason: string; count: number }[];
}

const EMPTY: UsageStats = {
  totalActions: 0,
  prevTotalActions: 0,
  activeUsers: 0,
  prevActiveUsers: 0,
  newSignups: 0,
  prevNewSignups: 0,
  creditsSpent: 0,
  prevCreditsSpent: 0,
  creditsRefunded: 0,
  actionsPerActiveUser: 0,
  prevActionsPerActiveUser: 0,
  daily: [],
  byFeature: [],
  topUsers: [],
  planCounts: [],
  neverActive: 0,
  activeThisWeek: 0,
  activeLastWeek: 0,
  jobStatuses: [],
  jobFailureRate: 0,
  failedRequests: [],
  refunds: [],
};

const ROW_CAP = 20000;

interface Event {
  at: string;
  userId: string | null;
  feature: FeatureKey;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function useUsageStats(range: RangeKey) {
  const [stats, setStats] = useState<UsageStats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const { since, prevSince } = useMemo(() => {
    const days = RANGE_OPTIONS.find((r) => r.id === range)?.days ?? null;
    if (days === null) return { since: null as string | null, prevSince: null as string | null };
    const now = Date.now();
    return {
      since: new Date(now - days * 86400000).toISOString(),
      prevSince: new Date(now - 2 * days * 86400000).toISOString(),
    };
  }, [range]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const from = prevSince; // fetch double window so we can compare periods
      const bound = <T,>(q: T): T => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = q as any;
        return (from ? query.gte("created_at", from) : query) as T;
      };

      const [citRes, qaRes, ledgerRes, jobsRes, logsRes, profilesRes] = await Promise.all([
        bound(
          supabase
            .from("citation_history")
            .select("user_id, created_at")
            .order("created_at", { ascending: false })
            .limit(ROW_CAP),
        ),
        bound(
          supabase
            .from("qa_logs")
            .select("user_id, task_mode, created_at")
            .order("created_at", { ascending: false })
            .limit(ROW_CAP),
        ),
        bound(
          supabase
            .from("credit_ledger")
            .select("user_id, event_type, amount, reason, created_at")
            .order("created_at", { ascending: false })
            .limit(ROW_CAP),
        ),
        bound(
          supabase
            .from("legal_research_jobs")
            .select("status, created_at")
            .order("created_at", { ascending: false })
            .limit(ROW_CAP),
        ),
        bound(
          supabase
            .from("activity_logs")
            .select("action, details, created_at")
            .eq("action", "request_failed")
            .order("created_at", { ascending: false })
            .limit(ROW_CAP),
        ),
        supabase.from("profiles").select("id, email, full_name, plan, created_at").limit(5000),
      ]);

      const inRange = (at: string) => (since ? at >= since : true);
      const inPrev = (at: string) => (since && prevSince ? at >= prevSince && at < since : false);

      // --- Build the unified action stream -------------------------------
      const events: Event[] = [];
      for (const row of citRes.data ?? []) {
        events.push({ at: row.created_at, userId: row.user_id, feature: "citation" });
      }
      for (const row of qaRes.data ?? []) {
        events.push({
          at: row.created_at,
          userId: row.user_id,
          feature: featureFromTaskMode(row.task_mode as string | null),
        });
      }
      const ledger = (ledgerRes.data ?? []) as {
        user_id: string;
        event_type: string;
        amount: number;
        reason: string | null;
        created_at: string;
      }[];
      // Bibliography has no table of its own — its ledger charges are the record.
      for (const row of ledger) {
        if (row.event_type === "consume" && featureFromReason(row.reason) === "bibliography") {
          events.push({ at: row.created_at, userId: row.user_id, feature: "bibliography" });
        }
      }

      const current = events.filter((e) => inRange(e.at));
      const previous = events.filter((e) => inPrev(e.at));

      // --- Daily buckets --------------------------------------------------
      const dayMap = new Map<string, DayPoint>();
      const days = RANGE_OPTIONS.find((r) => r.id === range)?.days ?? null;
      if (days !== null) {
        for (let i = days - 1; i >= 0; i--) {
          const key = dayKey(new Date(Date.now() - i * 86400000).toISOString());
          dayMap.set(key, {
            date: key,
            total: 0,
            citation: 0,
            research: 0,
            qa: 0,
            academic: 0,
            bibliography: 0,
            documents: 0,
            other: 0,
          });
        }
      }
      for (const e of current) {
        const key = dayKey(e.at);
        let point = dayMap.get(key);
        if (!point) {
          point = {
            date: key,
            total: 0,
            citation: 0,
            research: 0,
            qa: 0,
            academic: 0,
            bibliography: 0,
            documents: 0,
            other: 0,
          };
          dayMap.set(key, point);
        }
        point[e.feature] += 1;
        point.total += 1;
      }
      const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

      // --- Credits ---------------------------------------------------------
      let creditsSpent = 0;
      let prevCreditsSpent = 0;
      let creditsRefunded = 0;
      const creditsByFeature = new Map<FeatureKey, number>();
      const creditsByUser = new Map<string, number>();
      const refundReasons = new Map<string, number>();
      for (const row of ledger) {
        const spent = row.event_type === "consume" ? Math.max(0, -(row.amount ?? 0)) : 0;
        if (inRange(row.created_at)) {
          if (row.event_type === "consume") {
            creditsSpent += spent;
            const f = featureFromReason(row.reason);
            creditsByFeature.set(f, (creditsByFeature.get(f) ?? 0) + spent);
            creditsByUser.set(row.user_id, (creditsByUser.get(row.user_id) ?? 0) + spent);
          } else if (row.event_type === "refund") {
            creditsRefunded += Math.max(0, row.amount ?? 0);
            const reason = row.reason ?? "ללא סיבה";
            refundReasons.set(reason, (refundReasons.get(reason) ?? 0) + 1);
          }
        } else if (inPrev(row.created_at) && row.event_type === "consume") {
          prevCreditsSpent += spent;
        }
      }

      // --- Per-feature ------------------------------------------------------
      const actionsByFeature = new Map<FeatureKey, number>();
      const usersByFeature = new Map<FeatureKey, Set<string>>();
      const actionsByUser = new Map<string, number>();
      const activeUserIds = new Set<string>();
      const prevActiveUserIds = new Set<string>();
      for (const e of current) {
        actionsByFeature.set(e.feature, (actionsByFeature.get(e.feature) ?? 0) + 1);
        if (e.userId) {
          activeUserIds.add(e.userId);
          actionsByUser.set(e.userId, (actionsByUser.get(e.userId) ?? 0) + 1);
          const set = usersByFeature.get(e.feature) ?? new Set<string>();
          set.add(e.userId);
          usersByFeature.set(e.feature, set);
        }
      }
      for (const e of previous) if (e.userId) prevActiveUserIds.add(e.userId);

      const byFeature: FeatureStat[] = FEATURES.map((f) => ({
        key: f.key,
        label: f.label,
        actions: actionsByFeature.get(f.key) ?? 0,
        credits: creditsByFeature.get(f.key) ?? 0,
        users: usersByFeature.get(f.key)?.size ?? 0,
      }))
        .filter((f) => f.actions > 0 || f.credits > 0)
        .sort((a, b) => b.actions - a.actions);

      // --- Users --------------------------------------------------------------
      const profiles = (profilesRes.data ?? []) as {
        id: string;
        email: string | null;
        full_name: string | null;
        plan: string | null;
        created_at: string;
      }[];
      const profileById = new Map(profiles.map((p) => [p.id, p]));

      const topUsers: TopUser[] = [...actionsByUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, actions]) => {
          const p = profileById.get(id);
          return {
            id,
            name: p?.full_name || p?.email || id.slice(0, 8),
            plan: p?.plan || "—",
            actions,
            credits: creditsByUser.get(id) ?? 0,
          };
        });

      const planMap = new Map<string, number>();
      for (const p of profiles) {
        const plan = p.plan || "basic";
        planMap.set(plan, (planMap.get(plan) ?? 0) + 1);
      }
      const planCounts = [...planMap.entries()]
        .map(([plan, count]) => ({ plan, count }))
        .sort((a, b) => b.count - a.count);

      const everActive = new Set(events.filter((e) => e.userId).map((e) => e.userId as string));
      const neverActive = profiles.filter((p) => !everActive.has(p.id)).length;

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const thisWeek = new Set<string>();
      const lastWeek = new Set<string>();
      for (const e of events) {
        if (!e.userId) continue;
        if (e.at >= weekAgo) thisWeek.add(e.userId);
        else if (e.at >= twoWeeksAgo) lastWeek.add(e.userId);
      }

      const newSignups = profiles.filter((p) => inRange(p.created_at)).length;
      const prevNewSignups = profiles.filter((p) => inPrev(p.created_at)).length;

      // --- Reliability -----------------------------------------------------------
      const jobs = (jobsRes.data ?? []) as { status: string; created_at: string }[];
      const jobMap = new Map<string, number>();
      let jobsInRange = 0;
      let jobsFailed = 0;
      for (const j of jobs) {
        if (!inRange(j.created_at)) continue;
        jobsInRange += 1;
        if (j.status === "failed") jobsFailed += 1;
        jobMap.set(j.status, (jobMap.get(j.status) ?? 0) + 1);
      }
      const jobStatuses = [...jobMap.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);

      const failMap = new Map<string, number>();
      for (const row of (logsRes.data ?? []) as { details: unknown; created_at: string }[]) {
        if (!inRange(row.created_at)) continue;
        const d = (row.details ?? {}) as Record<string, unknown>;
        const code = String(d.code ?? d.status ?? "לא ידוע");
        failMap.set(code, (failMap.get(code) ?? 0) + 1);
      }
      const failedRequests = [...failMap.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count);

      const refunds = [...refundReasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);

      setStats({
        totalActions: current.length,
        prevTotalActions: previous.length,
        activeUsers: activeUserIds.size,
        prevActiveUsers: prevActiveUserIds.size,
        newSignups,
        prevNewSignups,
        creditsSpent,
        prevCreditsSpent,
        creditsRefunded,
        actionsPerActiveUser: activeUserIds.size ? current.length / activeUserIds.size : 0,
        prevActionsPerActiveUser: prevActiveUserIds.size ? previous.length / prevActiveUserIds.size : 0,
        daily,
        byFeature,
        topUsers,
        planCounts,
        neverActive,
        activeThisWeek: thisWeek.size,
        activeLastWeek: lastWeek.size,
        jobStatuses,
        jobFailureRate: jobsInRange ? (jobsFailed / jobsInRange) * 100 : 0,
        failedRequests,
        refunds,
      });
      setRefreshedAt(new Date());
    } catch (err) {
      console.error("[Admin] useUsageStats failed:", err);
    } finally {
      setLoading(false);
    }
  }, [range, since, prevSince]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return { stats, loading, refreshedAt, refresh: fetchStats, hasComparison: since !== null };
}
