import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success("התחברת בהצלחה!");
        navigate("/admin");
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" style={{ direction: "rtl" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🏛</div>
          <h1 className="text-2xl font-bold text-foreground">העוזמ״ש – ניהול</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isLogin ? "התחבר לפאנל הניהול" : "צור חשבון חדש"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">שם מלא</label>
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
              <label className="block text-sm font-medium text-foreground mb-1.5">אימייל</label>
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
              <label className="block text-sm font-medium text-foreground mb-1.5">סיסמה</label>
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

          <div className="mt-4 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-primary hover:underline"
            >
              {isLogin ? "אין לך חשבון? הירשם" : "יש לך חשבון? התחבר"}
            </button>
          </div>
        </div>

        <div className="text-center mt-4">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← חזור לעמוד הראשי
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
