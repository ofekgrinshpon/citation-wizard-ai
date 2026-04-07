import { useRef, useEffect, useState, type RefObject } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOffice } from "@/hooks/useOffice";
import { ReLexLogo } from "@/components/ReLexLogo";
import { GeometricBackground } from "@/components/GeometricBackground";
import { ChevronDown } from "lucide-react";

function useInView(ref: RefObject<HTMLElement | null>, threshold = 0.15) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, threshold]);
  return visible;
}

function StepCard({ step, index }: { step: typeof steps[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  return (
    <div
      ref={ref}
      className={`flex flex-col ${index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-8 transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
    >
      <div className="md:w-1/2 space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            {index + 1}
          </span>
          <h3 className="text-xl font-bold text-foreground">{step.title}</h3>
        </div>
        <p className="text-muted-foreground text-base leading-relaxed pr-11">
          {step.description}
        </p>
      </div>
      <div className="md:w-1/2 p-2">
        <img
          src={step.image}
          alt={step.title}
          className="rounded-xl border border-border shadow-lg w-full max-w-lg mx-auto"
          loading="lazy"
        />
      </div>
    </div>
  );
}

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
    <div className="min-h-screen bg-background relative" style={{ direction: "rtl" }}>
      <GeometricBackground />

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-4 relative z-10">
        {/* Glassmorphism card */}
        <div
          className="text-center space-y-6 max-w-lg w-full px-8 py-12 rounded-2xl relative"
          style={{
            background: "hsla(0, 0%, 100%, 0.55)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            border: "1px solid hsla(0, 0%, 100%, 0.7)",
            boxShadow: "0 8px 32px rgba(52, 152, 219, 0.08), inset 0 1px 0 hsla(0, 0%, 100%, 0.6)",
          }}
        >
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
              className="landing-cta-btn w-full max-w-xs mx-auto block py-3 rounded-xl font-bold text-sm text-primary-foreground"
              style={{ background: "var(--gradient-primary)" }}
            >
              התחילו!
            </button>
            <button
              onClick={() => navigate("/auth?mode=login")}
              className="text-sm text-primary hover:underline transition-colors"
            >
              כניסה למשתמש/ת קיימ/ת
            </button>
          </div>
        </div>

        <button
          onClick={scrollToHow}
          className="absolute bottom-16 md:bottom-8 text-muted-foreground hover:text-foreground transition-colors animate-bounce z-10"
          aria-label="גלילה למטה"
        >
          <ChevronDown className="w-8 h-8" />
        </button>
      </section>

      {/* How It Works Section */}
      <section ref={howRef} className="py-16 px-4 max-w-5xl mx-auto relative z-10">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-12">
          איך זה עובד?
        </h2>

        <div className="space-y-24">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} />
          ))}
        </div>

        <div className="text-center mt-16 space-y-4">
          <button
            onClick={() => navigate("/auth?mode=signup")}
            className="landing-cta-btn px-8 py-3 rounded-xl font-bold text-sm text-primary-foreground"
            style={{ background: "var(--gradient-primary)" }}
          >
            התחילו עכשיו!
          </button>
          <p className="text-[10px] text-muted-foreground">
            © 2026 ReLex. כל הזכויות שמורות.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Landing;
