import { Badge } from "@/components/ui/badge";
import { getVerifiedCategoryLabel, type VerifiedSourceCategory } from "@/lib/verifiedSources";

export interface VerifiedSourceRow {
  id: string;
  source_name: string;
  source_type: string;
  full_citation: string;
  auto_verified: boolean;
  verified_at: string;
  usage_count: number;
  verification_status: "verified" | "pending" | "invalid";
}

interface VerifiedSourcesTableProps {
  title: string;
  category: VerifiedSourceCategory;
  sources: VerifiedSourceRow[];
  onRemove: (source: VerifiedSourceRow) => void;
}

const VerifiedSourcesTable = ({ title, category, sources, onRemove }: VerifiedSourcesTableProps) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-foreground font-bold text-base">{title}</h3>
        <Badge variant="secondary">{sources.length} מקורות</Badge>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם מקור</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">קטגוריה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">ציטוט מלא</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">שימושים</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">אופן אימות</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך אימות</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    אין מקורות מאומתים בקטגוריה זו
                  </td>
                </tr>
              ) : (
                sources.map((source) => (
                  <tr key={source.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium max-w-[220px] truncate">{source.source_name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{getVerifiedCategoryLabel(category)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[320px] truncate">{source.full_citation}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{source.usage_count} פעמים</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={source.auto_verified ? "default" : "secondary"}>
                        {source.auto_verified ? "אוטומטי" : "ידני"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(source.verified_at).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onRemove(source)}
                        className="text-xs text-destructive hover:bg-destructive/10 px-2 py-1 rounded transition-colors"
                      >
                        הסר
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default VerifiedSourcesTable;
