import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

interface YearPreferences {
  hasHebrewYear: boolean;
  hasGregorianYear: boolean;
}

interface PublicationIntegrityCardProps {
  lawName: string;
  onConfirm: (prefs: YearPreferences) => void;
  onCancel: () => void;
}

export function PublicationIntegrityCard({ lawName, onConfirm, onCancel }: PublicationIntegrityCardProps) {
  const [hasHebrewYear, setHasHebrewYear] = useState(true);
  const [hasGregorianYear, setHasGregorianYear] = useState(true);

  return (
    <Card className="w-full max-w-md mx-auto border-primary/20 shadow-md" dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          📋 כרטיסיית וידוא פרסום
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          עבור: <span className="font-semibold text-foreground">{lawName}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50">
          <label htmlFor="hebrew-year" className="text-sm font-medium cursor-pointer flex-1">
            האם מופיעה שנה עברית בפרסום המקורי?
          </label>
          <div dir="ltr">
            <Switch
              id="hebrew-year"
              checked={hasHebrewYear}
              onCheckedChange={setHasHebrewYear}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50">
          <label htmlFor="gregorian-year" className="text-sm font-medium cursor-pointer flex-1">
            האם מופיעה שנה לועזית בפרסום המקורי?
          </label>
          <div dir="ltr">
            <Switch
              id="gregorian-year"
              checked={hasGregorianYear}
              onCheckedChange={setHasGregorianYear}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed border-r-2 border-primary/30 pr-3">
          בהתאם לכללים 2.4 ו-2.5, יש לציין שנה רק אם היא מופיעה במקור. אם אינך בטוח, בדוק ברשומות.
        </p>
      </CardContent>
      <CardFooter className="flex gap-2 pt-0">
        <Button onClick={() => onConfirm({ hasHebrewYear, hasGregorianYear })} className="flex-1">
          אישור
        </Button>
        <Button variant="outline" onClick={onCancel} className="flex-1">
          דילוג
        </Button>
      </CardFooter>
    </Card>
  );
}
