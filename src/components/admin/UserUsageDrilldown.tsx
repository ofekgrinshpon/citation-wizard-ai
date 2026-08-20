import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserUsage } from "@/hooks/useUserUsage";
import type { RangeKey, TopUser } from "@/hooks/useUsageStats";

interface Props {
  users: TopUser[];
  range: RangeKey;
}

const OUTCOME_LABEL: Record<string, string> = {
  answered: "נענה",
  refused: "ללא תוצאה",
  stub: "כשל טכני",
};

const UserUsageDrilldown = ({ users, range }: Props) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { usage, loading } = useUserUsage(selected, range);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    return users
      .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 12);
  }, [users, query]);

  const exportCsv = () => {
    const lines = ["date,section,outcome,credits,text"];
    for (const a of usage.actions) {
      lines.push(
        [
          new Date(a.at).toLocaleString("he-IL"),
          a.label,
          OUTCOME_LABEL[a.outcome] ?? a.outcome,
          a.credits,
          `"${a.text.replace(/"/g, "'").slice(0, 200)}"`,
        ].join(","),
      );
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relex-user-${selected?.slice(0, 8)}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-foreground font-bold text-sm">חיפוש משתמש</h3>
        {selected && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={usage.actions.length === 0}>
              הורדת CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              נקה בחירה
            </Button>
          </div>
        )}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש לפי שם או אימייל…"
        className="max-w-sm"
      />

      <div className="flex flex-wrap gap-2">
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו משתמשים עם פעילות בטווח שנבחר.</p>
        ) : (
          matches.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u.id)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                selected === u.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 border-border hover:bg-muted"
              }`}
            >
              {u.name} · {u.actions}
            </button>
          ))
        )}
      </div>

      {selected && (
        <div className="pt-2 border-t border-border space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">טוען נתוני משתמש…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-sm text-foreground">{usage.profile?.name}</span>
                <span className="text-xs text-muted-foreground">{usage.profile?.email}</span>
                <Badge variant="secondary">{usage.profile?.plan}</Badge>
                <span className="text-xs text-muted-foreground">
                  יתרה: {(usage.profile?.includedRemaining ?? 0) + (usage.profile?.topupRemaining ?? 0)} קרדיטים
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "פעולות בטווח", value: usage.totalActions },
                  { label: "קרדיטים שנוצלו", value: usage.creditsSpent },
                  { label: "זיכויים", value: usage.creditsRefunded },
                  { label: "מקטעים פעילים", value: usage.byFeature.length },
                ].map((m) => (
                  <div key={m.label} className="bg-muted/40 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className="text-lg font-bold text-foreground">{m.value}</div>
                  </div>
                ))}
              </div>

              {usage.daily.length > 0 && (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usage.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-right py-2">מקטע</th>
                      <th className="text-right py-2">פעולות</th>
                      <th className="text-right py-2">נענו</th>
                      <th className="text-right py-2">ללא תוצאה</th>
                      <th className="text-right py-2">קרדיטים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byFeature.map((f) => (
                      <tr key={f.key} className="border-b border-border/50">
                        <td className="py-2 text-foreground">{f.label}</td>
                        <td className="py-2 text-foreground">{f.actions}</td>
                        <td className="py-2 text-muted-foreground">{f.answered}</td>
                        <td className="py-2 text-muted-foreground">{f.refused + f.stub}</td>
                        <td className="py-2 text-muted-foreground">{f.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {usage.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-muted/30 rounded-md px-2.5 py-1.5">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(a.at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {a.label}
                    </Badge>
                    <span className="text-foreground flex-1 truncate">{a.text}</span>
                    <span
                      className={`shrink-0 ${
                        a.outcome === "answered" ? "text-muted-foreground" : "text-destructive"
                      }`}
                    >
                      {OUTCOME_LABEL[a.outcome]}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default UserUsageDrilldown;
