const steps = [
  ["מעלים עותק DOCX", "המערכת תחלץ את הערות השוליים מהמסמך."],
  ["מגינים על דברי הסבר", "אפשר לסמן טקסט שיישאר ללא שינוי. יתר הטקסט יישלח למנוע האזכור."],
  ["בודקים ומאשרים", "עוברים על הצעות התיקון ומאשרים את השינויים הרצויים."],
  ["מורידים עותק מתוקן", "השינויים שאושרו ייכללו בקובץ חדש. המסמך המקורי נשמר אצלכם."],
];

/** Informational only: the unpublished Word workflow is owned by another task. */
export function WordLaunchGuide() {
  return (
    <section aria-label="תיקון הערות שוליים ב־Word — בהכנה להשקה" className="rounded-2xl border border-border bg-card p-5 sm:p-7 space-y-4">
      <div>
        <p className="text-xs font-semibold text-primary mb-2">בהכנה להשקה</p>
        <h3 className="text-xl font-bold">מהערות שוליים לעותק Word מתוקן</h3>
        <p className="text-sm text-muted-foreground mt-2">כך מתוכנן לעבוד מסלול תיקון קובצי DOCX:</p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(([title, description], i) => (
          <li key={title} className="flex gap-3">
            <span aria-hidden="true" className="rounded-full bg-accent text-primary w-7 h-7 shrink-0 flex items-center justify-center font-bold">{i + 1}</span>
            <div><h4 className="text-sm font-semibold">{title}</h4><p className="text-sm text-muted-foreground mt-1">{description}</p></div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground leading-relaxed">כמה מקורות באותה הערה ואזכור חוזר נתמכים בתבניות מוגדרות. במקרים עמומים הטקסט נשאר כפי שהוא, ולעיתים נשמר אזכור מלא במקום קיצור. יש לבדוק את פרטי המקורות ואת עיצוב הקובץ לפני השימוש.</p>
    </section>
  );
}
