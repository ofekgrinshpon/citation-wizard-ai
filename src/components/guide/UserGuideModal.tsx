import { GuideIllustration } from "@/components/guide/GuideIllustration";
import { useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Quote, FileText, BookOpen } from "lucide-react";
import citationImg from "@/assets/guide/quick-citation-demo.webp";
import footnotesImg from "@/assets/guide/footnotes-approved.webp";
import bibliographyImg from "@/assets/guide/bibliography-demo.webp";

type Tool = {
  id: string;
  label: string;
  title: string;
  benefit: string;
  steps: [string, string][];
  image: string;
  alt: string;
  caption: string;
  Icon: typeof Quote;
};

const TOOLS: Tool[] = [
  {
    id: "citation", label: "אזכור מהיר", Icon: Quote,
    title: "מפרטי מקור לאזכור מסודר",
    benefit: "אזכורים לפי כללי האזכור האחיד, ובאנגלית לפי תבניות Bluebook נתמכות.",
    steps: [
      ["מזינים את המקור", "כותבים או מדביקים פרטי פסיקה, חקיקה או ספרות."],
      ["שולחים לעיבוד", "המערכת מזהה את סוג המקור ומעצבת את האזכור."],
      ["בודקים ומשלבים", "עוברים על הפרטים ועל הסימונים לצד התוצאה לפני השימוש."],
    ],
    image: citationImg,
    alt: "צילום מסך להמחשה: פרטי תיק בשדה השיחה ואזכור מעוצב מתחתיו.",
    caption: "הקלדה חופשית של פרטי המקור → אזכור מעוצב",
  },
  {
    id: "footnotes", label: "הערות שוליים", Icon: FileText,
    title: "בדיקת הערות שוליים במסמך Word",
    benefit: "משווים את ההערה המקורית לתיקון המוצע. רק תיקונים שאישרתם נכנסים לעותק החדש.",
    steps: [
      ["בוחרים מסמך", "מעלים קובץ Word עם הערות שוליים."],
      ["בוחרים מה לבדוק", "מסמנים דברי הסבר שלא לשנות, ובוחרים אילו מקורות לשלוח לבדיקה."],
      ["מאשרים ומורידים", "עוברים על ההצעות ומאשרים את התיקונים הרצויים. מורידים עותק מתוקן בלי לשנות את הקובץ המקורי."],
    ],
    image: footnotesImg,
    alt: "צילום מסך: הערת שוליים מקורית לצד הצעת תיקון שאושרה לעותק החדש.",
    caption: "הנוסח המקורי והתיקון המוצע, זה לצד זה",
  },
  {
    id: "bibliography", label: "ביבליוגרפיה", Icon: BookOpen,
    title: "מרשימת מקורות לביבליוגרפיה",
    benefit: "מפרידים בין עברית לאנגלית וממיינים לפי סוג המקור. ספרות משפטית ממוינת גם לפי שם המחבר.",
    steps: [
      ["מדביקים את הרשימה", "מזינים את כל המקורות, כל מקור בשורה נפרדת."],
      ["שולחים לבדיקה", "לוחצים על ״שלח לבדיקה״ ועוברים על שלב הבדיקה והתיקון."],
      ["מקבלים רשימה מסודרת", "מוסיפים את המקורות שנבדקו לביבליוגרפיה, ואפשר להעתיק את הרשימה ל־Word."],
    ],
    image: bibliographyImg,
    alt: "צילום מסך להמחשה: ביבליוגרפיה ממוינת לקטגוריות עם כפתור העתקה ל־Word.",
    caption: "ביבליוגרפיה מסודרת לפי קטגוריות",
  },
];


export function UserGuideModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState<Tool | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setZoomed(null);
    }
    onOpenChange(next);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = TOOLS.length;
    let next = active;
    // RTL: Left moves forward, Right moves back
    if (e.key === "ArrowLeft") next = (active + 1) % n;
    else if (e.key === "ArrowRight") next = (active - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const tool = TOOLS[active];
  const closeZoom = () => {
    setZoomed(null);
    requestAnimationFrame(() => tabRefs.current[active]?.focus());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-4xl w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto p-4 sm:p-7 gap-5 bg-background"
        style={{ direction: "rtl" }}
        onEscapeKeyDown={(e) => {
          if (!zoomed) return;
          e.preventDefault();
          closeZoom();
        }}
      >
        {zoomed ? (
          <>
            <DialogHeader className="text-right sm:text-right pl-8">
              <DialogTitle className="text-base" style={{ fontFamily: "inherit" }}>{zoomed.label}</DialogTitle>
              <DialogDescription className="text-xs">{zoomed.caption}</DialogDescription>
            </DialogHeader>
            <button type="button" onClick={closeZoom} className="w-fit text-sm font-medium text-primary underline">
              חזרה למדריך
            </button>
            <img src={zoomed.image} alt={zoomed.alt} className="w-full h-auto rounded-lg border border-border" />
          </>
        ) : (
          <>
              <DialogHeader className="text-right sm:text-right flex-row items-start justify-between gap-4 space-y-0 pl-8">
                <div className="space-y-1">
                  <p className="text-xs font-bold tracking-wide text-secondary">מדריך קצר להתחלה</p>
                  <DialogTitle className="text-2xl sm:text-3xl font-bold text-foreground" style={{ fontFamily: "inherit" }}>
                    איך ReLex עובד?
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">אזכורים, הערות שוליים וביבליוגרפיה — צעד אחר צעד.</DialogDescription>
                </div>
                <div className="hidden sm:block text-2xl font-bold tracking-tight text-primary" dir="ltr" aria-hidden="true">
                  Re<span className="text-secondary">Lex</span>
                </div>
              </DialogHeader>

              <section aria-labelledby="guide-tools-heading" className="space-y-3">
                <h3 id="guide-tools-heading" className="text-sm font-semibold text-muted-foreground" style={{ fontFamily: "inherit" }}>
                  מה תרצו לעשות?
                </h3>
                <div role="tablist" aria-label="כלי ReLex" onKeyDown={onTabKey} className="grid grid-cols-3 gap-2">
                  {TOOLS.map((t, i) => {
                    const sel = i === active;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        ref={(el) => (tabRefs.current[i] = el)}
                        role="tab"
                        id={`guide-tab-${t.id}`}
                        aria-controls={`guide-panel-${t.id}`}
                        aria-selected={sel}
                        tabIndex={sel ? 0 : -1}
                        onClick={() => setActive(i)}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs sm:px-3 sm:text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          sel ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                        }`}
                      >
                        <t.Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div
                  role="tabpanel"
                  id={`guide-panel-${tool.id}`}
                  aria-labelledby={`guide-tab-${tool.id}`}
                  tabIndex={0}
                  className="rounded-2xl border border-border bg-card p-4 sm:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: "inherit" }}>{tool.title}</h3>
                  <p className="text-sm text-secondary font-medium mt-0.5">{tool.benefit}</p>

                  <div className="mt-4 grid gap-5 md:grid-cols-[1fr_1.15fr] items-start">
                    <div className="space-y-4">
                      <ol className="space-y-3">
                        {tool.steps.map(([h, p], i) => (
                          <li key={h} className="flex gap-3">
                            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">
                              {i + 1}
                            </span>
                            <div>
                              <strong className="block text-sm text-foreground">{h}</strong>
                              <p className="text-sm text-muted-foreground leading-relaxed">{p}</p>
                            </div>
                          </li>
                        ))}
                      </ol>

                    </div>

                    <figure className="space-y-2">
                      <GuideIllustration key={tool.id} src={tool.image} alt={tool.alt} label={tool.label} fit="contain" onZoom={() => setZoomed(tool)} />
                      <figcaption className="text-xs text-muted-foreground">{tool.caption}</figcaption>
                    </figure>
                  </div>
                </div>
              </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
