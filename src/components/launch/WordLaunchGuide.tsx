const steps = [
  ["מעלים קובץ Word", "מעלים קובץ DOCX, ו־ReLex מחלצת ממנו את הערות השוליים לבדיקה."],
  ["בודקים ומאשרים", "משווים את הנוסח המקורי להצעה. אפשר לערוך אותה, לאשר אותה או להשאיר את ההערה כפי שהיא."],
  ["מורידים עותק מתוקן", "רק התיקונים שאישרתם ייכנסו לקובץ החדש. הקובץ המקורי לא משתנה."],
] as const;

export function WordLaunchGuide() {
  return (
    <section aria-labelledby="word-launch-guide-title" className="rounded-2xl border border-border bg-card p-5 sm:p-7 space-y-5">
      <div>
        <p className="text-xs font-semibold text-primary mb-2">תיקון הערות שוליים ב־Word</p>
        <h3 id="word-launch-guide-title" className="text-xl font-bold">מקובץ Word לעותק מתוקן בשלושה צעדים</h3>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(([title, description], i) => (
          <li key={title} className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <span aria-hidden="true" className="rounded-full bg-accent text-primary w-7 h-7 shrink-0 flex items-center justify-center font-bold">{i + 1}</span>
            <div>
              <h4 className="text-sm font-semibold">{title}</h4>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground leading-relaxed">מומלץ לבדוק את פרטי המקורות ואת עיצוב הקובץ לפני השימוש.</p>
    </section>
  );
}
