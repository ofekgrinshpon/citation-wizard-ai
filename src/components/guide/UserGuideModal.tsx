import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import howItWorksVideo from "@/assets/relex-how-it-works.mp4.asset.json";
import howItWorksPoster from "@/assets/relex-how-it-works-poster.jpg.asset.json";

const STEPS: { image: string; title: string; text: string }[] = [
  {
    image: "/how-it-works/step1.png",
    title: "שואלים שאלה משפטית",
    text: "בשפה חופשית, בדיוק כפי שהייתם מנסחים אותה לעמית.",
  },
  {
    image: "/how-it-works/step2.png",
    title: "איתור וקריאת מקורות",
    text: "פסקי דין, חקיקה ומאמרים רלוונטיים — נקראים ונבדקים.",
  },
  {
    image: "/how-it-works/step3.png",
    title: "תשובה מעוגנת בהערות שוליים",
    text: "כל טענה נסמכת על מקור, עם אזכורים לפי כללי האזכור האחיד.",
  },
  {
    image: "/how-it-works/step4.png",
    title: "העמקה והמשך עבודה",
    text: "שאלות המשך, אזכור אחיד, הערות שוליים וביבליוגרפיה.",
  },
];

export function UserGuideModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto"
        style={{ direction: "rtl" }}
      >
        <DialogHeader className="text-right">
          <DialogTitle className="text-right">איך ReLex עובד?</DialogTitle>
          <DialogDescription className="text-right">
            סרטון קצר וארבעה שלבים — זה כל מה שצריך כדי להתחיל.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
          <video
            src={howItWorksVideo.url}
            poster={howItWorksPoster.url}
            controls
            playsInline
            preload="metadata"
            className="w-full h-auto"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2"
            >
              <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
                <img
                  src={step.image}
                  alt={step.title}
                  loading="lazy"
                  className="w-full h-auto object-cover object-top max-h-32"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  <span className="text-primary ml-1">{i + 1}.</span>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {step.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
