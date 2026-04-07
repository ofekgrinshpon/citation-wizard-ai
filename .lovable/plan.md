

# הטמעת כללים 32–33: התכתבויות, ראיונות, הרצאות, הודעות לתקשורת וחומר אור-קולי

## סיכום

הוספת 7 סוגי מקור חדשים למערכת: התכתבויות (32.1), ראיונות (32.2), הרצאות (32.3), הודעות לתקשורת (32.4), סרטים (33.1), תוכניות טלוויזיה (33.2), ותוכניות רדיו (33.3). כולל זיהוי אוטומטי, תבניות עיצוב, והנחיות ל-AI. ללא חיפוש Perplexity.

## שינויים

### 1. `src/data/abbreviations.ts`

**SourceType** — הוספת 7 סוגים:
- `'correspondence'` — התכתבות (כלל 32.1)
- `'interview'` — ריאיון (כלל 32.2)
- `'lecture'` — הרצאה (כלל 32.3)
- `'press_release'` — הודעה לתקשורת (כלל 32.4)
- `'film'` — סרט (כלל 33.1)
- `'tv_show'` — תוכנית טלוויזיה (כלל 33.2)
- `'radio'` — רדיו/תסכית (כלל 33.3)

**REQUIRED_FIELDS**:
- `correspondence`: `['correspondenceType', 'senderName', 'recipientName', 'fullDate']`
- `interview`: `['intervieweeName', 'fullDate']`
- `lecture`: `['author', 'articleTitle', 'eventName', 'fullDate']`
- `press_release`: `['author', 'articleTitle', 'fullDate']`
- `film`: `['filmName', 'director', 'year']`
- `tv_show`: `['showName', 'channel', 'fullDate']`
- `radio`: `['showName', 'radioStation', 'fullDate']`

**FIELD_LABELS** — הוספת שדות חדשים:
- `correspondenceType`, `senderName`, `senderRole`, `recipientName`, `recipientRole`, `subject`
- `intervieweeName`, `interviewerName`, `intervieweeRole`, `interviewType`
- `eventName`, `eventLocation`
- `releaseDescription`
- `filmName`, `director`
- `showName`, `episodeName`, `channel`, `creator`
- `radioStation`, `timeReference`

**detectSourceType** — הוספת זיהוי (לפני בדיקות ספרות):
- `correspondence`: `/מכתב מ|דואר אלקטרוני מ|מזכר מ/`
- `interview`: `/ריאיון\s+(עם|של|טלפוני)/`
- `lecture`: `/הרצאה ב/`
- `press_release`: `/הודעה ל(תקשורת|עיתונות)|הודעת דובר/`
- `film`: `/במאי[תם]?\s|סרט\s/`
- `tv_show`: `/ערוץ\s+\d|טלוויזיה/` (אם גם שם בגרשיים)
- `radio`: `/גלי צה"ל|קול ברמה|רדיו|תסכית|תחנת\s/`

**SOURCE_TYPE_LABELS**, **RULE_REFERENCES** — הוספת ערכים מתאימים.

### 2. `src/data/citationEngine.ts`

הוספת 7 בלוקים ל-`CITATION_RULES`:

- **correspondence** (כלל 32.1): נוסחה, דוגמות, הערות על 32.1.1 ו-32.1.2
- **interview** (כלל 32.2): נוסחה, דוגמות
- **lecture** (כלל 32.3): נוסחה, דוגמות
- **press_release** (כלל 32.4): נוסחה, דוגמות
- **film** (כלל 33.1): נוסחה, הערה על שם במאי לפי 23.2
- **tv_show** (כלל 33.2): נוסחה, דוגמות, הערה על יוצר
- **radio** (כלל 33.3): נוסחה, דוגמות, הערה על 33.5 (הפניית זמן)

### 3. `src/components/SourceTypeConfirmation.tsx`

הוספת 7 קטגוריות ל-`SOURCE_CATEGORIES`:
- `correspondence` (✉️), `interview` (🎙️), `lecture` (🎤), `press_release` (📢), `film` (🎬), `tv_show` (📺), `radio` (📻)

### 4. `supabase/functions/citation-chat/index.ts`

**CITATION_ENGINE_TEMPLATES** — הוספת 7 רשומות עם נוסחאות, דוגמות ו-notes מפורטים:

- **"התכתבות"**: rule כלל 32.1, template + notes על סוגי התכתבות (32.1.1) ושמות/תפקידים (32.1.2), כולל דוגמת דוא"ל עם שעה
- **"ריאיון"**: rule כלל 32.2, שלוש צורות (ריאיון עם, ריאיון טלפוני, ריאיון של X עם Y)
- **"הרצאה"**: rule כלל 32.3, נוסחה עם שם דובר, שם הרצאה במירכאות, שם אירוע
- **"הודעה לתקשורת"**: rule כלל 32.4, נוסחה עם שם מודיע וכותרת הודעה
- **"סרט"**: rule כלל 33.1, שם סרט + במאי/ת + שנה, שמות לפי 23.2
- **"תוכנית טלוויזיה"**: rule כלל 33.2, שם תוכנית + פרק + יוצר + ערוץ + תאריך
- **"תוכנית רדיו"**: rule כלל 33.3, שם תוכנית + תחנה + תאריך, כולל הפניית זמן (33.5)

**System prompt** — הוספת הנחיות ל-AI לזיהוי תת-סוגים של כללים 32–33.

### 5. `src/lib/citationValidation.ts`

הוספת 7 סוגי מקור חדשים ל-validation (אם נדרש שדות חובה).

### פריסה
Edge Function — deploy אוטומטי.

