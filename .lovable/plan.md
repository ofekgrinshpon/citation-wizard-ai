

## מטרה
תיקון שני באגי-trust שהתגלו ב־QA:
1. משתמש לא מחובר שמגיע ל־`/app` מועבר ל־landing (`/`) במקום למסך ה־login (`/auth`).
2. דיאלוג "הגעת למכסה המרבית" אומר למשתמש ב־Basic שהוא ניצל את "האזכורים החינמיים" שלו, כאילו מדובר ב־trial חד-פעמי, בעוד שזה למעשה מכסה חודשית של 20 קרדיטים שמתחדשת.

## שינויים — שניהם ב־`src/pages/Index.tsx`

### 1. תיקון ה־redirect (שורות 145–152)
להחליף את ה־redirect ל־landing ב־redirect ל־`/auth?mode=login`, תוך שמירת `?addin=1` כשרלוונטי:

```tsx
// Require authentication — redirect unauthenticated users to login (preserve ?addin=1)
useEffect(() => {
  if (!authLoading && !user) {
    const params = new URLSearchParams(window.location.search);
    const addin = params.get("addin");
    const target = addin
      ? `/auth?mode=login&addin=${addin}`
      : "/auth?mode=login";
    navigate(target, { replace: true });
  }
}, [user, authLoading, navigate]);
```

הערות:
- `Auth.tsx` כבר תומך ב־`mode=login` כפרמטר URL (מתואר ב־memory `auth/navigation-logic-modes`).
- משתמש שיתחבר יחזור ל־`/app` דרך ה־`AuthRedirect` הקיים — אין צורך לשנות שם דבר.

### 2. תיקון נוסח דיאלוג "מכסה" (שורות 760–779)
להוסיף שימוש ב־`useCredits` לקריאת `billingPeriodEndsAt`, ולעדכן את הקופי כך שיתאר מכסה חודשית מתחדשת במקום "אזכורים חינמיים":

- להוסיף import: `import { useCredits } from "@/hooks/useCredits";`
- ליד `const subscription = useSubscription();` להוסיף:
  ```tsx
  const { billingPeriodEndsAt, planMeta } = useCredits();
  ```
- להחליף את הכותרת והפסקה בתוך הדיאלוג:
  ```tsx
  <h3 className="text-foreground text-lg font-bold mb-2">נגמרו הקרדיטים החודשיים</h3>
  <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
    ניצלת את כל {subscription.limit} הקרדיטים החודשיים בתכנית {planMeta.label}.
    {billingPeriodEndsAt
      ? <> הקרדיטים יתחדשו ב־{new Date(billingPeriodEndsAt).toLocaleDateString("he-IL")}.</>
      : null}
    {" "}ניתן לשדרג ל־Pro או להוסיף Top-up כדי להמשיך לעבוד עכשיו.
  </p>
  ```
- כפתור ה־CTA "שדרג ל-Pro" נשאר כפי שהוא — `navigate("/profile?tab=account")` כבר מציג גם שדרוג וגם Top-up.

### בדיקות מקדימות שכבר אומתו
- `useCredits` מחזיר `billingPeriodEndsAt` ו־`planMeta` (`src/hooks/useCredits.tsx`).
- `Auth.tsx` קורא `mode` מ־query string (מתועד ב־memory).
- ה־`AuthRedirect` הקיים ב־`App.tsx` יעביר משתמש מחובר חזרה ל־`/app` אחרי login, כולל שמירת `addin`.

## מחוץ ל־scope
- שינויי copy בדפים אחרים (Profile, Landing, Auth) — נשארים כמו שהם.
- שינוי טיפול ה־limit ב־`LegalQAChat` (שונה במהותו — מציג inline error card ולא דיאלוג חוסם).
- שינוי במנגנון renewal עצמו בצד ה־DB.

## תוצאה
- ניווט ל־`/app` ללא session → מסך login (`/auth?mode=login`) במקום landing. שמירת bookmarks ועמוקי-קישור עובדת.
- משתמשי Basic שהגיעו ל־0 רואים הודעה ברורה: "נגמרו הקרדיטים החודשיים בתכנית Basic, יתחדשו ב־DD/MM/YYYY", במקום הודעה מטעה על "אזכורים חינמיים".
- אין שינוי בהתנהגות עבור Pro / Admin (אצלם `isLimitReached` לא מופעל ממילא).

