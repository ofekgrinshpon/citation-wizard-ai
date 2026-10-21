export type SourceType = 
  | 'case_law_published'    // פסיקה מפ"ד
  | 'case_law_database'     // פסיקה ממאגר
  | 'primary_legislation'   // חקיקה ראשית
  | 'basic_law'             // חוק יסוד
  | 'secondary_legislation' // חקיקת משנה
  | 'bill'                  // הצעת חוק
  | 'book'                  // ספר
  | 'article'               // מאמר
  | 'article_in_book'       // מאמר שפורסם בספר
  | 'internet'              // מרשתת
  | 'internet_comment'      // תגובה במרשתת (כלל 34.2.9)
  | 'religious'             // מקור דתי
  | 'treaty'                // כתבי אמנה
  | 'regulation'            // תקנון (כלל 13.1)
  | 'government_decision'   // החלטות גופים שלטוניים (כלל 15)
  | 'expert_opinion'        // חוות דעת (כלל 16)
  | 'planning_plan'         // תכנית תכנון ובנייה (כלל 17.1)
  | 'collective_agreement'  // הסכם קיבוצי (כלל 17.2)
  | 'court_pleading'        // כתב טענות (כלל 22.2)
  | 'encyclopedia_entry'    // ערך במילון/אנציקלופדיה (כלל 25)
  | 'academic_work'         // עבודה אקדמית (כלל 26)
  | 'correspondence'        // התכתבות (כלל 32.1)
  | 'interview'             // ריאיון (כלל 32.2)
  | 'lecture'               // הרצאה (כלל 32.3)
  | 'press_release'         // הודעה לתקשורת (כלל 32.4)
  | 'film'                  // סרט (כלל 33.1)
  | 'tv_show'               // תוכנית טלוויזיה (כלל 33.2)
  | 'radio'                 // רדיו/תסכית (כלל 33.3)
  | 'foreign'                  // לועזי – fallback (כלל 36)
  | 'foreign_constitution'     // חוקה לועזית (כלל 36.1)
  | 'foreign_statute_us'       // חוק אמריקני (כלל 36.2)
  | 'foreign_statute_uk'       // חוק אנגלי (כלל 36.3)
  | 'foreign_case_us'          // פסיקה אמריקנית (כלל 36.4)
  | 'foreign_case_other'       // פסיקה ממדינות אחרות (כלל 36.5)
  | 'foreign_book'             // ספר לועזי (כלל 36.6)
  | 'foreign_journal_article'  // מאמר בכתב עת לועזי (כלל 36.7)
  | 'foreign_book_chapter'     // מאמר בספר לועזי (כלל 36.8)
  | 'foreign_internet'         // מקור מרשתת לועזי (כלל 36.9)
  | 'foreign_unpublished_manuscript' // כתב יד לועזי שלא פורסם (Bluebook 21 R17.2.1)
  | 'foreign_thesis'           // עבודת דוקטורט/תזה לועזית (Bluebook 21 R17.2.2)
  | 'foreign_newspaper'        // כתבה בעיתון מודפס לועזי (Bluebook 21 R16.6)
  | 'other'                 // אחר (דברי כנסת וכו')
  | 'unknown';

