import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ReLexLogo } from "@/components/ReLexLogo";
import { ContactSection } from "@/components/ContactSection";

export default function BusinessInfo({ page }: { page: "about" | "contact" }) {
  const title = page === "about" ? "אודות ReLex" : "צור קשר";

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ReLex`;
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="border-b border-border bg-card/50">
        <nav aria-label="ניווט ראשי" className="mx-auto flex max-w-5xl flex-wrap items-center gap-5 px-4 py-4">
          <Link to="/" aria-label="ReLex — עמוד הבית"><ReLexLogo size={32} /></Link>
          <Link to="/about" aria-current={page === "about" ? "page" : undefined} className="text-sm hover:underline">אודות</Link>
          <Link to="/contact" aria-current={page === "contact" ? "page" : undefined} className="text-sm hover:underline">צור קשר</Link>
          <Link to="/auth" className="mr-auto text-sm text-primary hover:underline">כניסה למערכת</Link>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-3xl px-5 pt-12 pb-6 space-y-6">
          <h1 className="text-3xl md:text-4xl font-bold">{title}</h1>
          {page === "about" ? (
            <>
              <p className="text-lg leading-8 text-muted-foreground">ReLex הוא שירות תוכנה מקוון שנועד לעזור בעבודה עם אזכורים משפטיים, הערות שוליים וביבליוגרפיה, כדי לפנות יותר זמן לקריאה ולכתיבה.</p>
              <h2 className="text-xl font-semibold">מה אפשר לעשות ב־ReLex?</h2>
              <ul className="list-disc pr-6 space-y-3 leading-7 text-muted-foreground">
                <li>ליצור אזכורים לפי כללי האזכור האחיד, עם תמיכה באנגלית וב־Bluebook בתבניות נתמכות.</li>
                <li>לארגן מקורות לביבליוגרפיה לפי קטגוריות וסדר אלפביתי, בעברית ובאנגלית.</li>
                <li>לעבוד עם הערות שוליים ומסמכי Word ביכולות הזמינות במערכת, לבחון את ההצעות ולבחור אילו תיקונים לאשר.</li>
              </ul>
              <h2 className="text-xl font-semibold">למי השירות מיועד?</h2>
              <p className="leading-7 text-muted-foreground">לסטודנטים למשפטים, חוקרים, משפטנים ועורכי דין שעובדים עם מקורות משפטיים. השירות דיגיטלי ונגיש דרך האתר; אין משלוח של מוצר פיזי.</p>
              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-xl font-semibold">כלי עזר, עם הבדיקה שלכם</h2>
                <p className="leading-7 text-muted-foreground">ReLex אינו נותן ייעוץ משפטי. התוצאות עשויות לכלול טעויות ודורשות בדיקה מול המקורות לפני הגשה או שימוש מקצועי. אין תמיכה בכל סוג מקור או בכל עיצוב Word, וחלק מהיכולות נמצאות בהכנה להשקה.</p>
              </div>
              <Link to="/contact" className="inline-block rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">שאלות? דברו איתנו</Link>
            </>
          ) : (
            <p className="text-lg leading-8 text-muted-foreground">אפשר לפנות באמצעות הטופס המקוון בהמשך העמוד או לשלוח דוא״ל ישירות לכתובות המפורטות בו. לפניות בנושא חיוב, ביטול או החזר: <a href="mailto:billing@relexlm.com" className="text-primary underline" dir="ltr">billing@relexlm.com</a>. אין לשלוח פרטי כרטיס אשראי או מסמכים חסויים.</p>
          )}
        </section>
        {page === "contact" && <ContactSection />}
      </main>
      <footer className="mx-auto max-w-5xl px-5 py-10">
        <nav aria-label="מידע נוסף" className="flex flex-wrap justify-center gap-5 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link to="/">עמוד הבית</Link><Link to="/about">אודות</Link><Link to="/contact">צור קשר</Link>
          <Link to="/terms">תנאי שימוש</Link><Link to="/privacy">מדיניות פרטיות</Link>
        </nav>
      </footer>
    </div>
  );
}
