import { useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Play, Maximize2, Clock, Quote, FileText, BookOpen, MessageSquare } from "lucide-react";
import videoAsset from "@/assets/guide/ReLex_How_It_Works.mp4.asset.json";
import posterAsset from "@/assets/guide/poster.jpg.asset.json";
import citationImg from "@/assets/guide/citation.jpg.asset.json";
import footnotesImg from "@/assets/guide/footnotes.jpg.asset.json";
import bibliographyImg from "@/assets/guide/bibliography.jpg.asset.json";
import assistantImg from "@/assets/guide/assistant.jpg.asset.json";

type Tool = {
  id: string;
  label: string;
  time: number;
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
    id: "citation", label: "אזכור אחיד", time: 3, Icon: Quote,
    title: "מפרטי מקור לאזכור מסודר",
    benefit: "אזכורים לפי כללי האזכור האחיד וה־Bluebook.",
    steps: [
      ["מזינים את המקור", "כותבים או מדביקים פרטי פסיקה, חקיקה או ספרות."],
      ["שולחים לעיבוד", "המערכת מזהה את סוג המקור ומעצבת את האזכור."],
      ["בודקים ומשלבים", "עוברים על הפרטים ועל הסימונים לצד התוצאה לפני השימוש."],
    ],
    image: citationImg.url,
    alt: "דוגמה אמיתית לאזכור שהופק ב־ReLex, עם פרטי המקור וסימוני הבדיקה.",
    caption: "הקלדה חופשית של פרטי המקור → אזכור מעוצב",
  },
  {
    id: "footnotes", label: "הערות שוליים", time: 18, Icon: FileText,
    title: "המקורות שלכם, לפי סדר ההופעה",
    benefit: "בניית הערות שוליים עם כללי האזכור החוזר.",
    steps: [
      ["מזינים לפי הסדר", "מוסיפים כל מקור בשורה נפרדת, לפי סדר ההופעה בעבודה."],
      ["בונים טיוטות", "לוחצים על ״בנה טיוטות לבדיקה״. אפשר להוסיף מקורות נוספים."],
      ["עוברים על ההערות", "בודקים את הטיוטות ואת פרטי המקורות לפני השילוב בעבודה."],
    ],
    image: footnotesImg.url,
    alt: "מסך הזנת המקורות להערות שוליים: שורות ממוספרות וכפתור להוספת מקור.",
    caption: "מזינים את המקורות בסדר שבו יופיעו בעבודה",
  },
  {
    id: "bibliography", label: "ביבליוגרפיה", time: 29, Icon: BookOpen,
    title: "מרשימת מקורות לביבליוגרפיה",
    benefit: "מיון לפי קטגוריות וסדר אלפביתי, בעברית ובאנגלית.",
    steps: [
      ["מדביקים את הרשימה", "מזינים את כל המקורות, כל מקור בשורה נפרדת."],
      ["שולחים לבדיקה", "לוחצים על ״שלח לבדיקה״ ועוברים על שלב הבדיקה והתיקון."],
      ["מקבלים רשימה מסודרת", "ממשיכים לביבליוגרפיה ובודקים את הרשימה לפני השימוש."],
    ],
    image: bibliographyImg.url,
    alt: "מסך הביבליוגרפיה: תיבת רשימת המקורות ושלושת שלבי ההדבקה, הבדיקה והביבליוגרפיה.",
    caption: "רשימה אחת, כל מקור בשורה נפרדת",
  },
  {
    id: "assistant", label: "העוזר המשפטי", time: 38, Icon: MessageSquare,
    title: "שאלה משפטית בשפה שלכם",
    benefit: "תשובה עם הפניות למקורות, והמשך שיחה באותו נושא.",
    steps: [
      ["שואלים שאלה", "מתארים את הסוגיה ואת ההקשר המשפטי שרוצים לברר."],
      ["קוראים את התשובה", "עוברים על ההסבר ועל ההפניות המצורפות."],
      ["מעמיקים במקורות", "פותחים את הקישורים, בודקים את המקורות וממשיכים בשאלת המשך."],
    ],
    image: assistantImg.url,
    alt: "קטע מתשובת העוזר המשפטי ב־ReLex, הכולל הסבר והפניות למקורות.",
    caption: "שאלה חופשית → תשובה עם הפניות למקורות",
  },
];

const fmt = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

export function UserGuideModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState<Tool | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      videoRef.current?.pause();
      setZoomed(null);
    }
    onOpenChange(next);
  };

  const playChapter = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
    void v.play().catch(() => {});
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

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-4xl w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto p-4 sm:p-7 gap-5 bg-background"
          style={{ direction: "rtl" }}
          onEscapeKeyDown={(e) => { if (zoomed) e.preventDefault(); }}
        >
          <DialogHeader className="text-right sm:text-right flex-row items-start justify-between gap-4 space-y-0 pl-8">
            <div className="space-y-1">
              <p className="text-xs font-bold tracking-wide text-secondary">מדריך קצר להתחלה</p>
              <DialogTitle className="text-2xl sm:text-3xl font-bold text-foreground" style={{ fontFamily: "inherit" }}>
                איך ReLex עובד?
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">סרטון קצר וארבע דרכים להתחיל.</DialogDescription>
            </div>
            <div className="hidden sm:block text-2xl font-bold tracking-tight text-primary" dir="ltr" aria-hidden="true">
              Re<span className="text-secondary">Lex</span>
            </div>
          </DialogHeader>

          <section aria-label="סרטון הסבר על ReLex" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <video
              ref={videoRef}
              src={videoAsset.url}
              poster={posterAsset.url}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label="איך ReLex עובד — סרטון הדגמה"
              className="block w-full aspect-video bg-muted object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground border-t border-border">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                <strong className="text-foreground font-semibold">היכרות קצרה עם ReLex</strong>
                <span aria-hidden="true">·</span>
                <bdi>0:58</bdi>
              </span>
              <span>אפשר לקפוץ להדגמה של כל כלי</span>
            </div>
          </section>

          <section aria-labelledby="guide-tools-heading" className="space-y-3">
            <h3 id="guide-tools-heading" className="text-sm font-semibold text-muted-foreground" style={{ fontFamily: "inherit" }}>
              מה תרצו לעשות?
            </h3>
            <div role="tablist" aria-label="כלי ReLex" onKeyDown={onTabKey} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TOOLS.map((t, i) => {
                const sel = i === active;
                return (
                  <button
                    key={t.id}
                    ref={(el) => (tabRefs.current[i] = el)}
                    role="tab"
                    id={`guide-tab-${t.id}`}
                    aria-controls={`guide-panel-${t.id}`}
                    aria-selected={sel}
                    tabIndex={sel ? 0 : -1}
                    onClick={() => setActive(i)}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      sel ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    <t.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
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
                  <button
                    onClick={() => playChapter(tool.time)}
                    aria-label={`לצפייה בהדגמת ${tool.label} בסרטון, מדקה ${fmt(tool.time)}`}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>לצפייה בהדגמה</span>
                    <time className="opacity-80 text-xs" dir="ltr">{fmt(tool.time)}</time>
                  </button>
                </div>

                <figure className="space-y-2">
                  <button
                    onClick={() => setZoomed(tool)}
                    aria-label={`להגדלת צילום המסך: ${tool.label}`}
                    className="group relative block w-full overflow-hidden rounded-xl border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img src={tool.image} alt={tool.alt} loading="lazy" className="block w-full h-auto max-h-64 object-cover object-top" />
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm border border-border">
                      <Maximize2 className="h-3 w-3" aria-hidden="true" />
                      הגדלה
                    </span>
                  </button>
                  <figcaption className="text-xs text-muted-foreground">{tool.caption}</figcaption>
                </figure>
              </div>
            </div>
          </section>
        </DialogContent>
      </Dialog>

      <Dialog open={!!zoomed} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="max-w-5xl w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-auto p-3 sm:p-4" style={{ direction: "rtl" }}>
          <DialogHeader className="text-right sm:text-right pl-8">
            <DialogTitle className="text-base" style={{ fontFamily: "inherit" }}>{zoomed?.label}</DialogTitle>
            <DialogDescription className="text-xs">{zoomed?.caption}</DialogDescription>
          </DialogHeader>
          {zoomed && <img src={zoomed.image} alt={zoomed.alt} className="w-full h-auto rounded-lg border border-border" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
