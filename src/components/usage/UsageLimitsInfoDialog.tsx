import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Public, pre-purchase explanation of how ReLex usage limits work. */
export const UsageLimitsInfoDialog = ({ open, onOpenChange }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent dir="rtl" className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-right">איך מגבלות השימוש עובדות?</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm text-muted-foreground text-right leading-relaxed">
        <p>
          מכיוון שפעולות מחקר מבוססות AI שונות בהיקפן ובעלות החישוב שלהן, היקף השימוש בפועל
          משתנה לפי סוג הפעולה.
        </p>
        <p>
          התוכניות כוללות מכסת שימוש קצרת טווח שמתחדשת אוטומטית כל 5 שעות, וכן מכסה כוללת
          לתקופת התוכנית.
        </p>
        <p>
          ReLex יציג לכם כאשר אתם מתקרבים למגבלה ואת הזמן המדויק שנותר עד לחידוש השימוש.
          אם אתם צריכים להמשיך מיד, ניתן לרכוש תוספת שימוש.
        </p>
        <p>
          חיפוש מקורות, סיכום פסק דין וכלי ציטוט צורכים בדרך כלל פחות ממחקר משפטי מלא.
        </p>

        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2">
          <p className="font-semibold text-foreground">היקף משוער לכל תוכנית</p>
          <ul className="space-y-1">
            <li>התנסות חינם — עד כ־3 מחקרים משפטיים מלאים</li>
            <li>שבוע — עד כ־9 מחקרים משפטיים מלאים לאורך התקופה</li>
            <li>חודש — עד כ־28 מחקרים משפטיים מלאים לאורך התקופה</li>
            <li>סמסטר — עד כ־72 מחקרים משפטיים מלאים לאורך התקופה</li>
          </ul>
          <p className="text-xs">
            אלו דוגמאות בלבד. שילוב של חיפוש מקורות, סיכומי פסיקה וכלי ציטוט מאפשר מספר גדול
            יותר של פעולות.
          </p>
        </div>

        <p className="text-xs">
          פעולות כבדות כפופות גם למגבלת שימוש קצרת טווח המתחדשת כל 5 שעות. התוכניות בבטא הן
          לתקופה קצובה ואינן מתחדשות אוטומטית בתשלום.
        </p>

        <div className="flex flex-wrap gap-3 text-xs pt-1">
          <a href="/terms" className="text-primary hover:underline">תנאי שימוש</a>
          <a href="/privacy" className="text-primary hover:underline">מדיניות פרטיות</a>
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
