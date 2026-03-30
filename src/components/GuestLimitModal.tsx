import { useNavigate } from "react-router-dom";

export function GuestLimitModal() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ direction: "rtl" }}>
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
      <div className="relative bg-card border border-border rounded-2xl p-6 max-w-sm mx-4 shadow-lg text-center animate-fade-in">
        <div className="text-4xl mb-3">🔒</div>
        <h3 className="text-foreground text-lg font-bold mb-2">
          הגעת למכסה המקסימלית לאורח
        </h3>
        <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
          כדי להמשיך להשתמש בעוזר המשפטי האוטומטי, אנא הירשם למערכת.
        </p>
        <button
          onClick={() => navigate("/")}
          className="w-full py-3 rounded-xl font-semibold text-sm text-primary-foreground transition-all"
          style={{ background: "var(--gradient-primary)" }}
        >
          הירשם עכשיו
        </button>
        <button
          onClick={() => navigate("/")}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          חזרה לעמוד הראשי
        </button>
      </div>
    </div>
  );
}
