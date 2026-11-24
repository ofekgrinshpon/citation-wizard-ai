import { Link } from "react-router-dom";
import { CitationPassStatusList } from "@/components/CitationPassAccount";
import { useAuth } from "@/hooks/useAuth";

/**
 * URL parameters never constitute payment proof. Account status is read back
 * through an authenticated RPC; the browser cannot settle or grant anything.
 */
const PaymentReturn = () => {
  const { user } = useAuth();
  return (
  <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 space-y-4 text-foreground">
      <h1 className="text-2xl font-bold">חזרה מעמוד התשלום</h1>
      <p>החזרה לעמוד זה אינה מהווה אישור לכך שהתשלום בוצע או התקבל.</p>
      {user ? <CitationPassStatusList /> : <Link to="/auth?mode=login" className="text-primary underline">כניסה לבדיקת מצב הרכישה</Link>}
      <p className="text-sm text-muted-foreground">מצב החשבון והמכסה מוצגים תמיד בעמוד החשבון.</p>
      <nav className="flex flex-wrap gap-3 pt-2">
        <Link to="/profile" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">לעמוד החשבון</Link>
        <Link to="/" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">לדף הבית</Link>
      </nav>
    </section>
  </main>
  );
};

export default PaymentReturn;
