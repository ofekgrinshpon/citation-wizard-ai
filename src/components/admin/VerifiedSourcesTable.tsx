import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getVerifiedCategoryLabel, getVerificationStatusLabel, type VerifiedSourceCategory } from "@/lib/verifiedSources";

const CASE_NUMBER_RE = /(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+\d+\/\d+/;

function extractCaseNumber(sourceName: string, fullCitation: string): string {
  const match = sourceName.match(CASE_NUMBER_RE) || fullCitation.match(CASE_NUMBER_RE);
  return match ? match[0] : sourceName;
}

function RenderCitation({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const idx = remaining.indexOf("**");
    if (idx === -1) { parts.push(<span key={key++}>{remaining}</span>); break; }
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    const close = remaining.indexOf("**", idx + 2);
    if (close === -1) { parts.push(<span key={key++}>{remaining.slice(idx)}</span>); break; }
    parts.push(<strong key={key++} className="font-bold">{remaining.slice(idx + 2, close)}</strong>);
    remaining = remaining.slice(close + 2);
  }
  return <>{parts}</>;
}

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
  onEdit?: (source: VerifiedSourceRow, updates: { source_name: string; full_citation: string; verification_status: string }) => void;
}

const VerifiedSourcesTable = ({ title, category, sources, onRemove, onEdit }: VerifiedSourcesTableProps) => {
  const [editingSource, setEditingSource] = useState<VerifiedSourceRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editCitation, setEditCitation] = useState("");
  const [editStatus, setEditStatus] = useState("pending");

  const openEdit = (source: VerifiedSourceRow) => {
    setEditingSource(source);
    setEditName(source.source_name);
    setEditCitation(source.full_citation);
    setEditStatus(source.verification_status);
  };

  const handleSave = () => {
    if (!editingSource || !onEdit) return;
    onEdit(editingSource, {
      source_name: editName.trim(),
      full_citation: editCitation.trim(),
      verification_status: editStatus,
    });
    setEditingSource(null);
  };

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
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך אימות</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr>
                   <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    אין מקורות מאומתים בקטגוריה זו
                  </td>
                </tr>
              ) : (
                sources.map((source) => (
                  <tr key={source.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium max-w-[220px] truncate">
                      {category === "caselaw" ? extractCaseNumber(source.source_name, source.full_citation) : source.source_name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{getVerifiedCategoryLabel(category)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[320px] truncate">
                      <RenderCitation text={source.full_citation} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{source.usage_count} פעמים</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={source.auto_verified ? "default" : "secondary"}>
                        {source.auto_verified ? "אוטומטי" : "ידני"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={
                        source.verification_status === "verified" ? "default" :
                        source.verification_status === "invalid" ? "destructive" : "secondary"
                      }>
                        {getVerificationStatusLabel(source.verification_status || "pending")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(source.verified_at).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(source)}
                          className="text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors"
                        >
                          ערוך
                        </button>
                        <button
                          onClick={() => onRemove(source)}
                          className="text-xs text-destructive hover:bg-destructive/10 px-2 py-1 rounded transition-colors"
                        >
                          הסר
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!editingSource} onOpenChange={(open) => !open && setEditingSource(null)}>
        <DialogContent className="sm:max-w-lg" style={{ direction: "rtl" }}>
          <DialogHeader>
            <DialogTitle>עריכת מקור מאומת</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">שם מקור</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ direction: "rtl" }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">ציטוט מלא</label>
              <textarea
                value={editCitation}
                onChange={(e) => setEditCitation(e.target.value)}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm resize-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                style={{ direction: "rtl" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">סטטוס</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="verified">✅ מאומת</SelectItem>
                  <SelectItem value="pending">⏳ ממתין</SelectItem>
                  <SelectItem value="invalid">❌ לא תקין</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditingSource(null)}>ביטול</Button>
            <Button onClick={handleSave} disabled={!editName.trim() || !editCitation.trim()}>שמור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VerifiedSourcesTable;
