import { Link } from "react-router-dom";

/**
 * Return destination after the hosted payment page. Deliberately static:
 * it never reads the URL query, never calls the server, never writes or grants
 * anything, and never claims success. Only verified server evidence may ever
 * confirm a payment, and that confirmation is not connected yet.
 */
const PaymentReturn = () => (
  <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 space-y-4 text-foreground">
      <h1 className="text-2xl font-bold">חזרה מעמוד התשלום</h1>
      <p>החזרה לעמוד זה אינה מהווה אישור לכך שהתשלום בוצע או התקבל.</p>
      <p>אישור תשלום אוטומטי עדיין אינו מחובר לאתר, ולכן לא נוסף דבר לחשבון שלך.</p>
      <p className="text-sm text-muted-foreground">מצב החשבון והמכסה מוצגים תמיד בעמוד החשבון.</p>
      <nav className="flex flex-wrap gap-3 pt-2">
        <Link to="/profile" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">לעמוד החשבון</Link>
        <Link to="/" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">לדף הבית</Link>
      </nav>
    </section>
  </main>
);

export default PaymentReturn;
