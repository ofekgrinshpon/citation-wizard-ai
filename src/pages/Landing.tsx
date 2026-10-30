import { GuideIllustration } from "@/components/guide/GuideIllustration";
import { useRef, useEffect, useState, type RefObject } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOffice } from "@/hooks/useOffice";
import { ReLexLogo } from "@/components/ReLexLogo";
import { GeometricBackground } from "@/components/GeometricBackground";
import { ContactSection } from "@/components/ContactSection";

import { ChevronDown } from "lucide-react";
import { LaunchPricing } from "@/components/launch/LaunchPricing";
import { WordLaunchGuide } from "@/components/launch/WordLaunchGuide";
import guideCitationImg from "@/assets/guide/citation.jpg.asset.json";
import guideFootnotesImg from "@/assets/guide/footnotes.jpg.asset.json";
import guideBibliographyImg from "@/assets/guide/bibliography.jpg.asset.json";

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

type Capability = {
  title: string;
  description: string;
  image: string;
  highlight?: boolean;
  chips?: string[];
};

const capabilities: Capability[] = [
  {
    title: "אזכור אחיד",
    description:
      "מפרטי מקור לאזכור מסודר לפי כללי האזכור האחיד. תמיכה באנגלית וב־Bluebook בתבניות נתמכות.",
    image: guideCitationImg.url,
  },
  {
    title: "הערות שוליים",
    description:
      "המקורות שלכם, לפי סדר ההופעה — עם אזכור חוזר במקרים נתמכים ובדיקה לפני השימוש.",
    image: guideFootnotesImg.url,
  },
  {
    title: "ביבליוגרפיה",
    description:
      "מרשימת מקורות לביבליוגרפיה — מיון לפי קטגוריות וסדר אלפביתי, בעברית ובאנגלית.",
    image: guideBibliographyImg.url,
  },
];

function CapabilityCard({ cap, index }: { cap: Capability; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 80}ms` }}
      className={`group relative flex flex-col rounded-2xl border bg-card p-5 transition-all duration-700 ease-out hover:-translate-y-1 hover:shadow-xl ${
        cap.highlight
          ? "border-primary/40 shadow-md shadow-primary/10"
          : "border-border shadow-sm hover:border-primary/30"
      } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
    >
    
      <div className="mb-4"><GuideIllustration src={cap.image} alt={cap.title} label={cap.title} /></div>
      <h3 className="text-lg md:text-xl font-bold text-foreground mb-2">
        {cap.title}
      </h3>
      <p className="text-sm md:text-[15px] text-muted-foreground leading-relaxed flex-1">
        {cap.description}
      </p>
      {cap.chips && (
        <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
          {cap.chips.map((chip) => (
            <span
              key={chip}
              className="px-2.5 py-0.5 rounded-full bg-accent text-accent-foreground text-[11px] font-medium"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const Landing = () => {
  const { user, loading: authLoading } = useAuth();
  const { isOfficeAddin } = useOffice();
  const navigate = useNavigate();
  const howRef = useRef<HTMLDivElement>(null);
  const pricingRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);



  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    // Always route to /app — don't wait for role resolution or route to heavy admin dashboard
    const addinParam = isOfficeAddin ? "?addin=1" : "";
    return <Navigate to={`/app${addinParam}`} replace />;
  }

  const scrollToHow = () => {
    howRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToPricing = () => {
    pricingRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToContact = () => {
    contactRef.current?.scrollIntoView({ behavior: "smooth" });
  };



  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background relative" style={{ direction: "rtl" }}>
      <GeometricBackground />

      {/* Top Navigation Bar */}
      <header
        className="sticky top-0 z-30 w-full border-b border-white/20 shadow-sm"
        style={{
          background: "var(--gradient-primary)",
        }}
      >
        <nav className="w-full min-h-14 md:h-16 flex-wrap py-2 md:py-0 pr-1 md:pr-2 pl-3 md:pl-4 flex items-center gap-2 md:gap-3">
          {/* Logo (RTL start, hugs the right edge) */}
          <button
            onClick={scrollToTop}
            className="flex items-center transition-opacity hover:opacity-80"
            aria-label="ReLex - חזרה לראש העמוד"
          >
            <ReLexLogo size={36} className="brightness-0 invert -translate-y-0.5 md:-translate-y-1" />
          </button>

          {/* Nav buttons next to logo (RTL: appear right after logo) */}
          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={scrollToHow}
              className="px-2 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium text-white/90 hover:text-white hover:bg-white/15 transition-colors"
            >
              איך זה עובד
            </button>
            <button
              onClick={scrollToPricing}
              className="px-2 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium text-white/90 hover:text-white hover:bg-white/15 transition-colors"
            >
              כמה זה עולה
            </button>
            <button
              onClick={scrollToContact}
              className="px-2 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium text-white/90 hover:text-white hover:bg-white/15 transition-colors"
            >
              יצירת קשר
            </button>
          </div>


          {/* Spacer pushes the login button to the far left edge */}
          <div className="flex-1" />

          {/* Login button (RTL end / left side) */}
          <button
            onClick={() => navigate("/auth?mode=login")}
            className="px-4 md:px-5 py-2 rounded-lg text-xs md:text-sm font-bold bg-white text-primary shadow-md hover:shadow-lg hover:bg-white/95 transition-all hover:-translate-y-0.5"
          >
            התחברות
          </button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 relative z-10">
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
            אזכורים מסודרים. יותר זמן לכתיבה.
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
              ליצירת חשבון
            </button>
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                onClick={() => navigate("/auth?mode=login")}
                className="text-primary hover:underline transition-colors"
              >
                כניסה למשתמש/ת קיימ/ת
              </button>
              <span className="text-border">·</span>
              <button
                onClick={scrollToPricing}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                צפו בתכניות
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={scrollToHow}
          className="absolute bottom-16 md:bottom-8 flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors animate-bounce z-10"
          aria-label="גלילה למטה"
        >
          <span className="text-sm font-medium">איך זה עובד?</span>
          <ChevronDown className="w-8 h-8" />
        </button>
      </section>

      {/* Capabilities Section */}
      <section ref={howRef} className="py-16 px-4 max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-12 space-y-3">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground">
            מהמקור ועד רשימת המקורות
          </h2>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
            אזכור אחיד, הערות שוליים וביבליוגרפיה — עם בדיקה שלכם לפני השילוב בעבודה.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {capabilities.map((cap, i) => (
            <CapabilityCard key={cap.title} cap={cap} index={i} />
          ))}
        </div>

        <div className="mt-8"><WordLaunchGuide /></div>
        <p className="text-center text-sm text-muted-foreground mt-6">התוצאות דורשות בדיקה מול המקורות. אין תמיכה בכל סוג מקור או בכל עיצוב Word.</p>

        <div className="text-center mt-16">
          <button
            onClick={scrollToPricing}
            className="landing-cta-btn px-8 py-3 rounded-xl font-bold text-sm text-primary-foreground"
            style={{ background: "var(--gradient-primary)" }}
          >
            לבחירת תכנית
          </button>
        </div>
      </section>

      {/* Pricing Section */}
      <section ref={pricingRef} className="py-16 px-4 max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-12 space-y-3">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground">
            תוכנית שמתאימה לקצב הכתיבה שלך
          </h2>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
            שני מסלולים מתוכננים להשקה: שבועי וחודשי, עם מכסת מקורות לכל מחזור חיוב.
          </p>
        </div>

        <LaunchPricing />
      </section>

      {/* Contact Section */}
      <ContactSection ref={contactRef} />

      <footer className="pb-16 px-4 max-w-6xl mx-auto relative z-10">
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">

          <a href="/terms" className="hover:text-foreground transition-colors">תנאי שימוש</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-foreground transition-colors">מדיניות פרטיות</a>
          <span>·</span>
          <a href="mailto:support@relexlm.com" className="hover:text-foreground transition-colors" dir="ltr">support@relexlm.com</a>
        </div>

        <p className="text-[10px] text-muted-foreground text-center mt-4">
          © 2026 ReLex. כל הזכויות שמורות.
        </p>
      </footer>

    </div>
  );
};

export default Landing;
