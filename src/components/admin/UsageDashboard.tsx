import { useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/admin/StatCard";
import UserUsageDrilldown from "@/components/admin/UserUsageDrilldown";
import {
  useUsageStats,
  RANGE_OPTIONS,
  FEATURES,
  type RangeKey,
  type FeatureKey,
} from "@/hooks/useUsageStats";

const SERIES_COLOR: Record<FeatureKey, string> = {
  citation: "hsl(var(--chart-1))",
  research: "hsl(var(--chart-2))",
  qa: "hsl(var(--chart-3))",
  academic: "hsl(var(--chart-4))",
  bibliography: "hsl(var(--chart-5))",
  documents: "hsl(var(--chart-7))",
  other: "hsl(var(--chart-6))",
};

function Delta({ current, previous, enabled }: { current: number; previous: number; enabled: boolean }) {
  if (!enabled) return null;
  if (previous === 0) {
    if (current === 0) return <span className="text-xs text-muted-foreground">ללא שינוי</span>;
    return <span className="text-xs text-primary">חדש בתקופה זו</span>;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span className={`text-xs ${up ? "text-primary" : "text-destructive"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% מהתקופה הקודמת
    </span>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-foreground font-bold text-sm mb-4">{title}</h3>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

interface Props {
  /** The existing source-library counters + most-cited list, kept at the bottom. */
  librarySection?: ReactNode;
}

const UsageDashboard = ({ librarySection }: Props) => {
  const [range, setRange] = useState<RangeKey>("30d");
  const [excludeInternal, setExcludeInternal] = useState(true);
  const { stats, loading, refreshedAt, refresh, hasComparison } = useUsageStats(range, excludeInternal);

  const maxFeatureActions = Math.max(1, ...stats.byFeature.map((f) => f.actions));

  const exportCsv = () => {
    const header = ["date", "total", ...FEATURES.map((f) => f.key)];
    const lines = [header.join(",")];
    for (const d of stats.daily) {
      lines.push([d.date, d.total, ...FEATURES.map((f) => d[f.key])].join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relex-usage-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRange(opt.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                range === opt.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={excludeInternal}
              onChange={(e) => setExcludeInternal(e.target.checked)}
              className="accent-primary"
            />
            שימוש אמיתי בלבד
          </label>
          {refreshedAt && (
            <span className="text-xs text-muted-foreground">
              עודכן {refreshedAt.toLocaleTimeString("he-IL")}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? "טוען…" : "רענון"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={stats.daily.length === 0}>
            הורדת CSV
          </Button>
        </div>
      </div>

      {/* 1. Headline numbers */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <StatCard icon="⚡" label="סה״כ פעולות" value={stats.totalActions} color="text-primary" />
          <div className="px-1">
            <Delta current={stats.totalActions} previous={stats.prevTotalActions} enabled={hasComparison} />
          </div>
        </div>
        <div className="space-y-1">
          <StatCard icon="🧑‍💻" label="משתמשים פעילים" value={stats.activeUsers} />
          <div className="px-1">
            <Delta current={stats.activeUsers} previous={stats.prevActiveUsers} enabled={hasComparison} />
          </div>
        </div>
        <div className="space-y-1">
          <StatCard icon="🆕" label="הרשמות חדשות" value={stats.newSignups} />
          <div className="px-1">
            <Delta current={stats.newSignups} previous={stats.prevNewSignups} enabled={hasComparison} />
          </div>
        </div>
        <div className="space-y-1">
          <StatCard icon="🪙" label="קרדיטים שנוצלו" value={stats.creditsSpent} />
          <div className="px-1">
            <Delta current={stats.creditsSpent} previous={stats.prevCreditsSpent} enabled={hasComparison} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          icon="📊"
          label="פעולות בממוצע למשתמש פעיל"
          value={Math.round(stats.actionsPerActiveUser * 10) / 10}
        />
        <StatCard icon="↩️" label="קרדיטים שהוחזרו" value={stats.creditsRefunded} />
      </div>

      {/* 2. Usage over time */}
      <Panel title="📈 שימוש לאורך זמן">
        {stats.daily.length === 0 ? (
          <EmptyRow text="אין פעילות בטווח שנבחר." />
        ) : (
          <div className="h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: string) => v.slice(5)}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {FEATURES.map((f) => (
                  <Area
                    key={f.key}
                    type="monotone"
                    dataKey={f.key}
                    name={f.label}
                    stackId="1"
                    stroke={SERIES_COLOR[f.key]}
                    fill={SERIES_COLOR[f.key]}
                    fillOpacity={0.35}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* 3. Usage by feature */}
      <Panel title="🧩 שימוש לפי כלי">
        {stats.byFeature.length === 0 ? (
          <EmptyRow text="אין פעילות בטווח שנבחר." />
        ) : (
          <div className="space-y-3">
            {stats.byFeature.map((f) => {
              const share = stats.totalActions ? Math.round((f.actions / stats.totalActions) * 100) : 0;
              return (
                <div key={f.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground font-medium">{f.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {f.actions} פעולות · {share}% · {f.credits} קרדיטים · {f.users} משתמשים
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(f.actions / maxFeatureActions) * 100}%`,
                        background: SERIES_COLOR[f.key],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* 4. Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="🏅 משתמשים מובילים">
          {stats.topUsers.length === 0 ? (
            <EmptyRow text="אין משתמשים פעילים בטווח שנבחר." />
          ) : (
            <div className="space-y-2">
              {stats.topUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.plan}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{u.actions} פעולות</Badge>
                    <Badge variant="outline">{u.credits} קרדיטים</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="👥 תמהיל תוכניות ושימור">
          <div className="space-y-2 mb-4">
            {stats.planCounts.map((p) => (
              <div key={p.plan} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{p.plan}</span>
                <Badge variant="secondary">{p.count}</Badge>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center border-t border-border/50 pt-4">
            <div>
              <p className="text-xl font-bold text-primary">{stats.activeThisWeek}</p>
              <p className="text-xs text-muted-foreground">פעילים השבוע</p>
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{stats.activeLastWeek}</p>
              <p className="text-xs text-muted-foreground">פעילים בשבוע שעבר</p>
            </div>
            <div>
              <p className="text-xl font-bold text-muted-foreground">{stats.neverActive}</p>
              <p className="text-xs text-muted-foreground">נרשמו ולא השתמשו</p>
            </div>
          </div>
        </Panel>
      </div>

      {/* 5. Reliability */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={`⚙️ מחקרים (${Math.round(stats.jobFailureRate)}% כשל)`}>
          {stats.jobStatuses.length === 0 ? (
            <EmptyRow text="אין ריצות מחקר בטווח." />
          ) : (
            <div className="space-y-2">
              {stats.jobStatuses.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.status}</span>
                  <Badge variant={s.status === "failed" ? "destructive" : "secondary"}>{s.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="🚨 בקשות שנכשלו">
          {stats.failedRequests.length === 0 ? (
            <EmptyRow text="לא נרשמו כשלים בטווח." />
          ) : (
            <div className="space-y-2">
              {stats.failedRequests.map((f) => (
                <div key={f.code} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate max-w-[70%]">{f.code}</span>
                  <Badge variant="destructive">{f.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="↩️ החזרי קרדיטים">
          {stats.refunds.length === 0 ? (
            <EmptyRow text="לא בוצעו החזרים בטווח." />
          ) : (
            <div className="space-y-2">
              {stats.refunds.map((r) => (
                <div key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate max-w-[70%]">{r.reason}</span>
                  <Badge variant="secondary">{r.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 6. Source library (kept from the previous panel) */}
      <UserUsageDrilldown users={stats.allUsers} range={range} />

      {librarySection}
    </div>
  );
};

export default UsageDashboard;
