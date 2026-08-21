# עדכון תוכניות מחיר / קרדיטים — מעבר לבטא

משנה את כל ערכי התוכניות (UI + backend + נתונים קיימים) לערכים החדשים. החלטות שאושרו: לכווץ גם משתמשים קיימים לערכים החדשים, ותווית "בטא" מופיעה רק בכרטיסי התמחור בדף הנחיתה.

## ערכי היעד

| תוכנית | priceLabel | includedCredits | אורך תקופה | resetMode |
|---|---|---|---|---|
| basic | חינם | 10 | חודש קלנדרי | calendar_month |
| pro_monthly | 29 ₪ / חודש | 250 | חודש | billing_period |
| pro_semester | 80 ₪ / 3 חודשים | 900 | 3 חודשים | period_bucket |
| pro_annual | 199 ₪ / שנה | 3000 | שנה | period_bucket |
| admin | — | 0 | — | none |

שינויים ממצב נוכחי: basic 20→10, pro_monthly 39→29 ₪, pro_semester 129 ₪/4 חודשים/1100 → 80 ₪/3 חודשים/900, pro_annual 299 ₪/3600 → 199 ₪/3000. resetMode ו־allowsTopup ללא שינוי.

## 1. Backend — מיגרציה (שינוי סכמה: פונקציות + ברירות מחדל)

מיגרציה חדשה שמגדירה מחדש את שלושת עזרי התוכנית:

- `_plan_credits`: basic→10, pro_monthly→250, pro_semester→900, pro_annual→3000.
- `_plan_period_length`: pro_semester `interval '4 months'` → `interval '3 months'`. השאר ללא שינוי.
- `_plan_reset_mode`: ללא שינוי.
- `ALTER TABLE public.profiles` — `included_credits_remaining` ו־`included_credits_total` `SET DEFAULT 10` (כיום ברירת המחדל 20, ולכן הרשמות חדשות מקבלות 20 במקום 10).

המיגרציה כוללת רק הגדרות פונקציה ו־ALTER COLUMN — לא עדכוני נתונים (אלו בשלב 2).

## 2. Backend — כיווץ משתמשים קיימים (כלי insert / נתונים)

הרצת `UPDATE` על `public.profiles` (דרך כלי הנתונים, שרץ כ־service_role ועובר את טריגר `prevent_profile_sensitive_updates`):

```sql
-- basic
UPDATE profiles
   SET included_credits_total = 10,
       included_credits_remaining = LEAST(included_credits_remaining, 10)
 WHERE plan = 'basic';
-- pro_semester
UPDATE profiles
   SET included_credits_total = 900,
       included_credits_remaining = LEAST(included_credits_remaining, 900)
 WHERE plan = 'pro_semester';
-- pro_annual
UPDATE profiles
   SET included_credits_total = 3000,
       included_credits_remaining = LEAST(included_credits_remaining, 3000)
 WHERE plan = 'pro_annual';
```

pro_monthly (250) ו־admin ללא שינוי. הלוגיקה: `total = ערך חדש`, `remaining = LEAST(remaining, ערך חדש)` — כך שמי שניצל פחות לא נפגע, ומי שעבר את התקרה החדשה נחתך אליה. החידוש החודשי היומי (`reset_or_renew_credits`) ישתמש מעתה בערכים החדשים אוטומטית כי הוא קורא ל־`_plan_credits`.

## 3. Frontend — `src/lib/plans.ts`

עדכון שדות `priceLabel` ו־`includedCredits` (ושדה `tagline` של pro_semester מ־"4 חודשים" ל־"3 חודשים"):

- basic: `includedCredits: 10`.
- pro_monthly: `priceLabel: "29 ₪ / חודש"`.
- pro_semester: `priceLabel: "80 ₪ / 3 חודשים"`, `includedCredits: 900`, `tagline` מתואם.
- pro_annual: `priceLabel: "199 ₪ / שנה"`, `includedCredits: 3000`.

שדה `label` נשאר ללא "בטא" (כדי שהפרופיל/סיידבר יישארו נקיים). `resetMode`/`allowsTopup` ללא שינוי.

## 4. Frontend — `src/pages/Landing.tsx` (כרטיסי תמחור)

- עדכון מחרוזות ה־`perks`: "20 קרדיטים בחודש"→"10 קרדיטים בחודש", "1,100 קרדיטים ל-4 חודשים"→"900 קרדיטים ל-3 חודשים", "3,600 קרדיטים בשנה"→"3,000 קרדיטים בשנה".
- הוספת תגית "בטא" על שלושת כרטיסי ה־Pro (badge קטן ליד השם/המחיר). כרטיס הבייסיק ללא תגית.
- אין שינוי לשמות התוכניות בשאר האפליקציה (פרופיל/סיידבר נשארים "Pro חודשי" וכו' ללא "בטא").

## קבצים שיישתנו

- מיגרציה חדשה: `supabase/migrations/<timestamp>_plans_beta.sql`
- `src/lib/plans.ts`
- `src/pages/Landing.tsx`

## סדר ביצוע

1. מיגרציה (פונקציות + ברירות מחדל).
2. כיווץ נתונים קיימים (כלי insert).
3. עדכון `plans.ts` + `Landing.tsx`.

## אימות

- `psql` על `_plan_credits('basic')` / `('pro_semester')` / `('pro_annual')` → 10 / 900 / 3000.
- בדיקת פרופיל משתמש basic קיים: total=10, remaining≤10.
- ויזואלי בלנדינג: מחירים חדשים + תגית "בטא" על כרטיסי Pro.
