import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const Landing = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect
  useEffect(() => {
    if (!authLoading && user) {
      navigate(isAdmin ? "/admin" : "/app", { replace: true });
    }
  }, [user, isAdmin, authLoading, navigate]);

  if (authLoading || user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success("התחברת בהצלחה!");
        // Routing handled by auth state change + useEffect in App
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) throw error;
        toast.success("נרשמת בהצלחה! בדוק את האימייל לאימות.");
      }
    } catch (err: any) {
      toast.error(err.message || "שגיאה בהתחברות");
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    navigate("/app?guest=true");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ direction: "rtl" }}>
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="text-center mb-10 max-w-lg">
          <div className="text-5xl mb-4">⚖️</div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3" style={{ fontFamily: "'Frank Ruhl Libre', serif" }}>
            העוזר המשפטי האוטומטי
          </h1>
          <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
            דיוק משפטי בלחיצת כפתור לפי כללי האזכור האחיד
          </p>
          <div className="flex items-center justify-center gap-4 mt-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">⚖️ פסיקה</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span className="flex items-center gap-1">📜 חקיקה</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span className="flex items-center gap-1">📚 ספרות</span>
          </div>
        </div>

        <div className="w-full max-w-md space-y-4">
          {/* Login/Register Card */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h2 className="text-foreground text-base font-bold mb-4 text-center">
              {isLogin ? "התחברות" : "הרשמה"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {!isLogin && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">שם מלא</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    placeholder="שם מלא"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">אימייל</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  placeholder="your@email.com"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">סיסמה</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-semibold text-sm text-primary-foreground transition-all disabled:opacity-50"
                style={{ background: "var(--gradient-primary)" }}
              >
                {loading ? "מעבד..." : isLogin ? "התחבר" : "הירשם"}
              </button>
            </form>
            <div className="mt-3 text-center">
              <button onClick={() => setIsLogin(!isLogin)} className="text-xs text-primary hover:underline">
                {isLogin ? "אין לך חשבון? הירשם" : "יש לך חשבון? התחבר"}
              </button>
            </div>
            {!isLogin && (
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                גישה מלאה למערכת מותנית במנוי (בקרוב)
              </p>
            )}
          </div>

          {/* Guest Card */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm text-center">
            <p className="text-foreground text-sm font-semibold mb-1">רוצה לנסות לפני?</p>
            <p className="text-muted-foreground text-xs mb-3">
              2 אזכורים חינם ללא הרשמה
            </p>
            <button
              onClick={handleGuest}
              className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-primary/30 text-primary hover:bg-primary/5 transition-all"
            >
              כניסה כאורח (2 אזכורים חינם)
            </button>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground mt-8">
          כללי האזכור האחיד בכתיבה המשפטית • מהדורה שלישית 2021 • Bluebook 21st ed.
        </p>
      </div>
    </div>
  );
};

export default Landing;
