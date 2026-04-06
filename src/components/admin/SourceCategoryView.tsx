import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { RenderCitation } from "@/components/admin/RenderCitation";
import { useState } from "react";

interface SourceRecord {
  id: string;
  raw_input: string;
  formatted_output: string;
  source_type: string | null;
  is_verified: boolean;
  created_at: string;
}

interface SourceCategoryViewProps {
  title: string;
  sources: SourceRecord[];
  onToggleVerification: (citation: SourceRecord) => void;
  onBulkVerify?: (citations: SourceRecord[]) => void;
}

const SourceCategoryView = ({ title, sources, onToggleVerification, onBulkVerify }: SourceCategoryViewProps) => {
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = sources.filter((s) => {
    if (showUnverifiedOnly && s.is_verified) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.raw_input.toLowerCase().includes(q) || s.formatted_output.toLowerCase().includes(q);
    }
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCitations = filtered.filter((s) => selectedIds.has(s.id));
  const selectedUnverified = selectedCitations.filter((s) => !s.is_verified);
  const selectedVerified = selectedCitations.filter((s) => s.is_verified);

  const handleBulkVerify = () => {
    if (onBulkVerify && selectedUnverified.length > 0) {
      onBulkVerify(selectedUnverified);
      setSelectedIds(new Set());
    }
  };

  const handleBulkUnverify = () => {
    if (onBulkVerify && selectedVerified.length > 0) {
      onBulkVerify(selectedVerified);
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-foreground font-bold text-base">{title}</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={showUnverifiedOnly} onCheckedChange={setShowUnverifiedOnly} />
            <span className="text-xs text-muted-foreground">הצג רק ממתינים לאימות</span>
          </div>
          <Badge variant="secondary">{filtered.length} מקורות</Badge>
        </div>
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="חפש במקורות..."
        className="w-full bg-card border border-border rounded-lg px-4 py-2 text-foreground text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
      />

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} נבחרו</span>
          <div className="flex items-center gap-2 mr-auto">
            {selectedUnverified.length > 0 && (
              <Button size="sm" onClick={handleBulkVerify}>
                אמת {selectedUnverified.length} מקורות
              </Button>
            )}
            {selectedVerified.length > 0 && (
              <Button size="sm" variant="outline" onClick={handleBulkUnverify}>
                בטל אימות {selectedVerified.length} מקורות
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              בטל בחירה
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">קלט</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">פלט</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    אין מקורות בקטגוריה זו
                  </td>
                </tr>
              ) : (
                filtered.map((cit) => (
                  <tr key={cit.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${selectedIds.has(cit.id) ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3">
                      <Checkbox checked={selectedIds.has(cit.id)} onCheckedChange={() => toggleOne(cit.id)} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(cit.created_at).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[200px] truncate">{cit.raw_input}</td>
                    <td className="px-4 py-3 text-foreground max-w-[300px] truncate">
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <span className="cursor-pointer">
                            <RenderCitation text={cit.formatted_output} />
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-96 text-sm whitespace-pre-wrap break-words" dir="rtl" side="top">
                          <RenderCitation text={cit.formatted_output} />
                        </HoverCardContent>
                      </HoverCard>
                    </td>
                    <td className="px-4 py-3">
                      {cit.is_verified ? (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">✓ מאומת</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">ממתין לאימות</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onToggleVerification(cit)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${
                          cit.is_verified
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-primary hover:bg-primary/10"
                        }`}
                      >
                        {cit.is_verified ? "בטל אימות" : "אמת"}
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

export default SourceCategoryView;
