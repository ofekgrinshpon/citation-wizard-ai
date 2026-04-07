import { useRef } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOffice } from "@/hooks/useOffice";
import { ReLexLogo } from "@/components/ReLexLogo";
import { ChevronDown } from "lucide-react";

const steps = [
  {
    title: "הקלד מקור משפטי",
    description: "הזן בטקסט חופשי את המקור שברצונך לאזכר — פסק דין, חוק, מאמר או כל מקור אחר. המערכת תזהה אותו בעצמה.",
    image: "/how-it-works/step1.png",
  },
  {
    title: "קבל אזכור תקני",
    description: "המערכת מזהה את סוג המקור ומעצבת אותו לפי כללי האזכור האחיד — כולל קיצורים, סימני פיסוק ועיצוב טקסט.",
    image: "/how-it-works/step2.png",
  },
  {
    title: "בנה הערות שוליים",
    description: "הוסף מספר מקורות בבת אחת ובנה הערת שוליים שלמה עם מספור אוטומטי.",
    image: "/how-it-works/step3.png",
  },
  {
    title: "תוצאה מאומתת ומוכנה",
    description: "קבל הערות שוליים מוכנות להדבקה, עם אימות אוטומטי והתראות על פרטים חסרים.",
    image: "/how-it-works/step4.png",
  },
];

const Landing = () => {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { isOfficeAddin } = useOffice();
  const navigate = useNavigate();
  const howRef = useRef<HTMLDivElement>(null);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    const addinParam = isOfficeAddin ? "?addin=1" : "";
    return <Navigate to={isAdmin ? `/admin${addinParam}` : `/app${addinParam}`} replace />;
  }

  const scrollToHow = () => {
    howRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-4 relative">
        <div className="text-center space-y-6 max-w-lg">
          <div className="flex justify-center">
            <ReLexLogo size={80} />
          </div>
          <p className="text-xl md:text-2xl text-muted-foreground font-medium">
            העוזר המשפטי האוטומטי שלך
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">⚖️ פסיקה</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span className="flex items-center gap-1">📜 חקיקה</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span className="flex items-center gap-1">📚 ספרות</span>
          </div>
          <div className="space-y-3 pt-4">
            <button
              onClick={() => navigate("/auth?mode=signup")}
              className="w-full max-w-xs mx-auto block py-3 rounded-xl font-bold text-sm text-primary-foreground transition-all hover:opacity-90"
              style={{ background: "var(--gradient-primary)" }}
            >
              התחילו!
            </button>
            <button
              onClick={() => navigate("/auth?mode=login")}
              className="text-sm text-primary hover:underline"
            >
              כניסה למשתמש/ת קיימ/ת
            </button>
          </div>
        </div>

        <button
          onClick={scrollToHow}
          className="absolute bottom-8 text-muted-foreground hover:text-foreground transition-colors animate-bounce"
          aria-label="גלילה למטה"
        >
          <ChevronDown className="w-8 h-8" />
        </button>
      </section>

      {/* How It Works Section */}
      <section ref={howRef} className="py-16 px-4 max-w-5xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-12">
          איך זה עובד?
        </h2>

        <div className="space-y-16">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex flex-col ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-8`}
            >
              <div className="md:w-1/2 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </span>
                  <h3 className="text-lg font-bold text-foreground">{step.title}</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed pr-11">
                  {step.description}
                </p>
              </div>
              <div className="md:w-1/2">
                <img
                  src={step.image}
                  alt={step.title}
                  className="rounded-xl border border-border shadow-lg w-full"
                  loading="lazy"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-16 space-y-4">
          <button
            onClick={() => navigate("/auth?mode=signup")}
            className="px-8 py-3 rounded-xl font-bold text-sm text-primary-foreground transition-all hover:opacity-90"
            style={{ background: "var(--gradient-primary)" }}
          >
            התחילו עכשיו!
          </button>
          <p className="text-[10px] text-muted-foreground">
            כללי האזכור האחיד בכתיבה המשפטית • מהדורה שלישית 2021 • Bluebook 21st ed.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Landing;
