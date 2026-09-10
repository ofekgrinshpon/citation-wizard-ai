import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useOffice } from "@/hooks/useOffice";
import { ReLexLogo } from "@/components/ReLexLogo";
import { GeometricBackground } from "@/components/GeometricBackground";
import { signInWithOfficeDialog } from "@/lib/officeAuth";
import { isCanonicalHost, PUBLIC_SITE_URL, shouldRedirectOAuthToCanonicalHost } from "@/lib/publicUrl";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { LEGAL_VERSION } from "@/content/legal/version";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") !== "signup";
  const [isLogin, setIsLogin] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, user, loading: authLoading } = useAuth();
  const { isOfficeAddin } = useOffice();
  const navigate = useNavigate();

  // Capture ?ref= once (and persist across the OAuth round-trip via sessionStorage).
  useEffect(() => {
    const refFromUrl = searchParams.get("ref");
    if (refFromUrl && refFromUrl.length >= 4 && refFromUrl.length <= 16) {
      try { sessionStorage.setItem("relex_ref_code", refFromUrl.toUpperCase()); } catch { /* ignore */ }
    }
  }, [searchParams]);
  const refCode = (typeof window !== "undefined" && sessionStorage.getItem("relex_ref_code")) || null;

  useEffect(() => {
    const mode = searchParams.get("mode");
    if (mode === "signup") setIsLogin(false);
    else if (mode === "login") setIsLogin(true);
  }, [searchParams]);

  // Auto-trigger Google OAuth when arriving from a preview-host redirect (?oauth=google).
  useEffect(() => {
    if (searchParams.get("oauth") !== "google") return;
    if (!isCanonicalHost()) return;
    if (user) return;
    // Strip the trigger from the URL so a refresh doesn't re-fire it.
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete("oauth");
    window.history.replaceState({}, "", `${window.location.pathname}${cleaned.toString() ? `?${cleaned}` : ""}`);
    // Consent was ticked on the originating host; carry it into this host's session.
    if (searchParams.get("mode") === "signup") {
      try { sessionStorage.setItem("relex_legal_accepted", LEGAL_VERSION); } catch { /* ignore */ }
    }
    (async () => {
      try {
        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: `${window.location.origin}/auth-redirect`,
          extraParams: { prompt: "select_account" },
        });
        if (result.error) {
          console.error("[ReLex] Google OAuth error:", result.error);
          toast.error("שגיאה בהתחברות עם Google");
        }
      } catch (err: any) {
        console.error("[ReLex] Google OAuth exception:", err);
        toast.error("שגיאה בהתחברות עם Google");
      }
    })();
  }, [searchParams, user]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    const addinParam = isOfficeAddin ? "?addin=1" : "";
    // Don't wait for role resolution — always route to /app
    // Admins can navigate to /admin manually; this prevents heavy dashboard from blocking login
    return <Navigate to={`/app${addinParam}`} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success("התחברת בהצלחה!");
        const target = isOfficeAddin ? "/app?addin=1" : "/app";
        navigate(target, { replace: true });
      } else {
        if (!acceptedLegal) {
          toast.error("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
          return;
        }
        const { error } = await signUp(email, password, fullName, refCode || undefined, true);
        if (error) throw error;
        toast.success("נרשמת בהצלחה! בדוק את האימייל לאימות.");
        try { sessionStorage.removeItem("relex_ref_code"); } catch { /* ignore */ }
      }
    } catch (err: any) {
      toast.error(err.message || "שגיאה בהתחברות");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative" style={{ direction: "rtl" }}>
      <GeometricBackground />
      <div className="w-full max-w-md space-y-4 relative z-10">
        <div className="text-center mb-6">
          <div className="mb-3 flex justify-center">
            <ReLexLogo size={48} />
          </div>
          <p className="text-muted-foreground text-sm">
            {isLogin ? "התחברות" : "הרשמה"}
          </p>
        </div>

        {refCode && !isLogin && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground text-center">
            🎁 הצטרפת דרך הזמנה (<span className="font-mono">{refCode}</span>) — לאחר הפעולה הראשונה שלך תקבלו שניכם תוספת שימוש.
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
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
            {isLogin && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <span className="text-xs text-muted-foreground">זכור אותי</span>
                </label>
                <button
                  type="button"
                  onClick={() => navigate("/reset-password")}
                  className="text-xs text-primary hover:underline"
                >
                  שכחתי סיסמה
                </button>
              </div>
            )}
            {!isLogin && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedLegal}
                  onChange={(e) => setAcceptedLegal(e.target.checked)}
                  required
                  className="mt-0.5 w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/20"
                />
                <span className="text-xs text-muted-foreground leading-5">
                  קראתי ואני מסכים/ה ל
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">תנאי השימוש</a>
                  {" "}ול
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">מדיניות הפרטיות</a>
                </span>
              </label>
            )}
            <button
              type="submit"
              disabled={loading || (!isLogin && !acceptedLegal)}
              className="w-full py-3 rounded-xl font-semibold text-sm text-primary-foreground transition-all disabled:opacity-50"
              style={{ background: "var(--gradient-primary)" }}
            >
              {loading ? "מעבד..." : isLogin ? "התחבר/י" : "הירשמ/י"}
            </button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">או</span></div>
          </div>


          <button
            onClick={async () => {
              if (!isLogin && !acceptedLegal) {
                toast.error("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
                return;
              }
              if (!isLogin) {
                // Consent survives the OAuth round-trip; stamped on /auth-redirect.
                try { sessionStorage.setItem("relex_legal_accepted", LEGAL_VERSION); } catch { /* ignore */ }
              }
              if (isOfficeAddin) {
                try {
                  await signInWithOfficeDialog();
                  toast.success("התחברת בהצלחה!");
                } catch (err: any) {
                  toast.error(err.message || "שגיאה בהתחברות עם Google");
                }
              } else {
                try {
                  // Force OAuth to start from the canonical ReLex domain so users
                  // never see the oauth.lovable.app broker flash on preview hosts.
                  if (shouldRedirectOAuthToCanonicalHost()) {
                    const params = new URLSearchParams();
                    params.set("mode", isLogin ? "login" : "signup");
                    if (refCode) params.set("ref", refCode);
                    params.set("oauth", "google");
                    window.location.replace(`${PUBLIC_SITE_URL}/auth?${params.toString()}`);
                    return;
                  }
                  const result = await lovable.auth.signInWithOAuth("google", {
                    redirect_uri: `${window.location.origin}/auth-redirect`,
                    extraParams: { prompt: "select_account" },
                  });
                  if (result.error) {
                    console.error("[ReLex] Google OAuth error:", result.error);
                    toast.error("שגיאה בהתחברות עם Google");
                  }
                } catch (err: any) {
                  console.error("[ReLex] Google OAuth exception:", err);
                  toast.error("שגיאה בהתחברות עם Google");
                }
              }
            }}
            className="w-full py-2.5 rounded-xl font-semibold text-sm border border-border hover:bg-muted transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            התחברו עם Google
          </button>

          <div className="mt-3 text-center">
            <button onClick={() => setIsLogin(!isLogin)} className="text-xs text-primary hover:underline">
              {isLogin ? "אין לך חשבון? הירשמ/י" : "יש לך חשבון? התחבר/י"}
            </button>
          </div>
          {!isLogin && (
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              גישה מלאה למערכת מותנית במנוי (בקרוב)
            </p>
          )}
        </div>

        <div className="text-center">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← חזרה לעמוד הראשי
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
