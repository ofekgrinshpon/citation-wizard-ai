import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AddVerifiedSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  userId?: string;
}

const SOURCE_TYPES = [
  { value: "caselaw", label: "⚖️ פסיקה (Case Law)" },
  { value: "legislation_primary", label: "📜 חקיקה ראשית" },
  { value: "legislation_secondary", label: "📋 חקיקת משנה" },
  { value: "literature", label: "📖 ספרות ומאמרים" },
];

const CASE_NUMBER_REGEX = /(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+\d+\/\d+/;

const AddVerifiedSourceDialog = ({ open, onOpenChange, onAdded, userId }: AddVerifiedSourceDialogProps) => {
  const [sourceName, setSourceName] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [fullCitation, setFullCitation] = useState("");
  const [sourceType, setSourceType] = useState("caselaw");
  const [year, setYear] = useState("");
  const [saving, setSaving] = useState(false);

  const isCaselaw = sourceType === "caselaw";

  const handleSave = async () => {
    if (isCaselaw && !caseNumber.trim()) return;
    if (!isCaselaw && !sourceName.trim()) return;
    if (!fullCitation.trim()) return;
    setSaving(true);

    // For caselaw, the source_name is the case number
    const effectiveSourceName = isCaselaw ? caseNumber.trim() : sourceName.trim();
    const searchText = `${effectiveSourceName} ${fullCitation}`.toLowerCase();

    const { error } = await supabase.from("verified_sources").insert({
      source_name: effectiveSourceName,
      full_citation: fullCitation.trim(),
      source_type: sourceType,
      search_text: searchText,
      year: year.trim() || null,
      verification_status: "verified",
      auto_verified: false,
      verified_by: userId || null,
    });

    setSaving(false);

    if (error) {
      toast.error("שגיאה בהוספת מקור: " + error.message);
      return;
    }

    toast.success("מקור נוסף ואומת בהצלחה!");
    setSourceName("");
    setCaseNumber("");
    setFullCitation("");
    setSourceType("caselaw");
    setYear("");
    onOpenChange(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" style={{ direction: "rtl" }}>
        <DialogHeader>
          <DialogTitle>הוספת מקור מאומת חדש</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">סוג מקור</label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isCaselaw ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">מספר הליך (חובה)</label>
              <Input
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder='לדוגמה: ע"פ 1514/01'
                style={{ direction: "rtl" }}
              />
              <p className="text-[11px] text-muted-foreground">מספר ההליך ישמש כמזהה הייחודי של פסק הדין</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">שם מקור</label>
              <Input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder='לדוגמה: חוק-יסוד: הכנסת'
                style={{ direction: "rtl" }}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">ציטוט מלא</label>
            <textarea
              value={fullCitation}
              onChange={(e) => setFullCitation(e.target.value)}
              rows={3}
              placeholder='לדוגמה: חוק-יסוד: הכנסת, ס"ח 69'
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm resize-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              style={{ direction: "rtl" }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">שנה (אופציונלי)</label>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder='לדוגמה: 1958'
              style={{ direction: "rtl" }}
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={handleSave} disabled={saving || (isCaselaw ? !caseNumber.trim() : !sourceName.trim()) || !fullCitation.trim()}>
            {saving ? "שומר..." : "הוסף ואמת"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddVerifiedSourceDialog;
