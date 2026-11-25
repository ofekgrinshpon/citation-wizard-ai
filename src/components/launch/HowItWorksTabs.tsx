import { useState } from "react";
import citationImg from "@/assets/guide/citation-nachmani.png.asset.json";
import footnotesImg from "@/assets/guide/footnotes-approved.webp";
import bibliographyImg from "@/assets/guide/bibliography-sorted.png.asset.json";

type Tab = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  frame: string;
  image: string;
  alt: string;
};

const TABS: Tab[] = [
  {
    id: "citation",
    label: "אזכור מהיר",
    eyebrow: "מקור אחד בכל פעם",
    title: "מפרטי מקור לאזכור שאפשר להעתיק.",
    body: "מזינים מספר הליך, שם של חוק, ספר או מאמר. ReLex מנסה לזהות את המקור ולסדר את האזכור. כשיש כמה התאמות — בוחרים את הנכונה.",
    frame: "אזכור מהיר · מתוך ReLex",
    image: citationImg.url,
    alt: "צילום מסך: חיפוש נחמני נ' נחמני ושתי התאמות לבחירה",
  },
  {
    id: "footnotes",
    label: "הערות שוליים ב־Word",
    eyebrow: "סקירת מסמך",
    title: "מתקנים הערות שוליים. לא נוגעים במקור.",
    body: "מעלים קובץ Word ומשווים את ההערה המקורית להצעה של ReLex. רק מה שאישרתם ייכנס לעותק החדש.",
    bullets: ["אפשר לערוך את ההצעה לפני אישור", "אפשר להשאיר כל הערה כמו שהיא", "המסמך המקורי נשאר ללא שינוי"],
    frame: "תיקון הערות שוליים · מתוך ReLex",
    image: footnotesImg,
    alt: "צילום מסך: נוסח הערת שוליים לצד התיקון המוצע",
  },
  {
    id: "bibliography",
    label: "ביבליוגרפיה",
    eyebrow: "רשימת מקורות",
    title: "מרשימת מקורות לביבליוגרפיה מסודרת.",
    body: "המקורות ממוינים לפי קטגוריות ובסדר אלפביתי, בעברית ובאנגלית. אפשר להעביר מקור לקטגוריה אחרת ולהעתיק הכול ל־Word.",
    frame: "ביבליוגרפיה · מתוך ReLex",
    image: bibliographyImg.url,
    alt: "צילום מסך: ביבליוגרפיה ממוינת לפי חקיקה, פסיקה וספרות",
  },
];

export function HowItWorksTabs() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];
  return (
    <div dir="rtl">
      <div className="text-right mb-8 space-y-4">
        <h2 className="text-3xl md:text-5xl font-extrabold text-foreground leading-tight">
          מהמקור הראשון
          <br />
          ועד רשימת המקורות.
        </h2>
        <p className="text-muted-foreground text-sm md:text-base">
          עובדים על אזכור בודד, בודקים מסמך קיים או מסדרים את המקורות להגשה. בחרו מה תרצו לראות.
        </p>
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                t.id === active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/40"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-5 md:p-8 grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-8 items-center">
        <div className="space-y-4 text-right">
          <p className="text-primary font-semibold text-sm">{tab.eyebrow}</p>
          <h3 className="text-2xl md:text-4xl font-extrabold text-foreground leading-tight">{tab.title}</h3>
          <p className="text-muted-foreground leading-relaxed">{tab.body}</p>
          {tab.bullets && (
            <ul className="list-disc pr-5 space-y-1 text-sm text-muted-foreground">
              {tab.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
        </div>
        <a
          href={tab.image}
          target="_blank"
          rel="noreferrer"
          className="block rounded-2xl border border-border bg-muted/40 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <span className="text-sm font-semibold text-foreground">{tab.frame}</span>
            <span className="text-primary tracking-widest">•••</span>
          </div>
          <img src={tab.image} alt={tab.alt} className="w-full h-auto max-h-[460px] object-contain object-top bg-background" />
          <p className="px-4 py-2 text-xs text-muted-foreground text-right">צילום מסך מהמוצר · לחצו להגדלה</p>
        </a>
      </div>
    </div>
  );
}
