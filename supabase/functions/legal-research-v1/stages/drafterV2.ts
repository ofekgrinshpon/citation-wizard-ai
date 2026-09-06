// V2.1 — Structured Citation Drafter.
// The model writes Hebrew legal prose as structured blocks with explicit
// source_refs per paragraph/list_item. It never emits markers. The
// deterministic footnoteBuilder turns the structured draft into final
// markdown + footnotes + used_sources.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import { callAnthropicJsonTool } from "../lib/anthropic.ts";
import type { UserDocument } from "../lib/attachments.ts";
import {
  AnswerIntent,
  SourceUsePlan,
  Candidate,
  Claim,
  Footnote,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
  UsableCandidate,
  UsedSource,
  Verdict,
} from "../lib/types.ts";
import {
  summarizeSnippetBudget,
  type SnippetBudgetReport,
} from "./synthesisSnippetBudget.ts";
import {
  buildInputSources,
  type DrafterInputSource,
} from "./drafter.ts";
import {
  validateStructuredDraft,
  type StructuredDraft,
  type StructuredValidation,
} from "./structuredValidation.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import { tierRank, type AuthorityTier } from "./sourceIntegrity.ts";

import { normalizeHebrewNumberRanges } from "../../_shared/hebrewNumberRange.ts";
import { checkCompleteness, type CompletenessReport } from "./completenessCheck.ts";
import {
  detectStatuteSections,
  getStatuteSectionCanonicalEntry,
  getStatuteSectionCanonicalText,
  type StatuteSectionRef,
} from "./statuteSectionDetection.ts";
import { detectDockets, candidateMatchesDocket, type DocketRef } from "./docketDetection.ts";
import {
  assessSourceSufficiency,
  type SufficiencyAssessment,
} from "./sourceSufficiency.ts";
import {
  assessNamedDoctrineFraming,
  type NamedDoctrineFraming,
} from "./namedDoctrine.ts";
import {
  scrubNegativeExistenceClaims,
  NEGATIVE_EXISTENCE_PROMPT_RULE,
} from "./negativeExistenceGuard.ts";
import {
  applyMetadataOnlyHoldingGate,

  referenceOnlySection,
  type MetadataOnlyHoldingGateReport,
} from "./metadataOnlyHoldingGate.ts";
import {
  consolidateLimitationNotes,
  type NonAcademicLimitationNote,
} from "./nonAcademicBinding.ts";
import {
  applyClaimSourceMatch,
  type ClaimSourceMatchReport,
} from "./claimSourceMatch.ts";
import { academicPackFit } from "./academicAuthorityAlignment.ts";
import {
  assessResearchRichness,
  isLiteratureOnlyRequest,
  literatureSynthesisDirectives,
  type PackSelectionDecision,
  type RichnessAssessment,
  scoreLiteratureTopicality,
  selectLiteraturePack,
} from "./academicLiteratureRichness.ts";

import { applyBlockCeiling, type BlockTrimReport } from "./routerProfiles.ts";
import {
  buildDoctrinalTypingReport,
  type DoctrinalTypingReport,
  remapDoctrinalSourceTypes,
} from "./doctrinalSourceTyping.ts";
import {
  LIMITED_DOCTRINAL_ANSWER_NOTICE_HE,
  NARROW_LIMITED_DOCTRINAL_NOTICE_HE,
} from "./claimSupportCategory.ts";
import { planRequestsAcademicWriting } from "./sourceUseIntent.ts";
import {
  type AcademicGenre,
  type AcademicHygieneReport,
  applyAcademicPresentationHygiene,
} from "./academicPresentationHygiene.ts";
import {
  type AcademicStyleModelReport,
  buildAcademicStyleGuideBlock,
} from "./academicStyleGuide.ts";
import {
  type AcademicPromptCleanupReport,
  applyAcademicPromptCleanup,
  emptyAcademicPromptCleanupReport,
} from "./academicPromptCleanup.ts";
import {
  type AcademicDrafterSourceRefEmission,
  buildAcademicSourceRoleMap,
  buildLightCitationUseBlock,
  LIGHT_CITATION_GENRES,
  measureSourceRefEmission,
  type PreCsmSourceRefFiltering,
  renderSourceRoleMapBlock,
} from "./academicSourceRoleMap.ts";
import {
  applySourceRoleSanity,
  applyTopicAwareBlockAlignment,
  assessLimitationNoteAlignment,
  type LimitationNoteAlignment,
  type SourceRoleSanityReport,
  type TopicAwareAlignmentReport,
} from "./topicAwareAlignment.ts";
import {
  assessDrafterBlockCompliance,
  buildClaimSourcePlan,
  buildPostDraftAlignmentFilter,
  type ClaimSourcePlan,
  type DrafterBlockComplianceReport,
  type PostDraftAlignmentFilterReport,
  renderClaimSourcePlanBlock,
} from "./claimSourcePlanning.ts";
import {
  assessDrafterRepresentativeCompliance,
  assessRepresentativeSourceUse,
  buildRepresentativeSourceSelection,
  renderRepresentativeSourceBlock,
  type RepresentativeSourceReport,
} from "./representativeSourceSelection.ts";
import {
  buildSourceLastMileFunnel,
  type SourceLastMileFunnelReport,
} from "./sourceLastMileFunnel.ts";
import {
  enforceStatuteDominanceOnDraft,
  type StatuteDominanceCheck,
  verifyStatuteDominanceInFootnotes,
} from "./statuteDominance.ts";




/** academic_style_model_v1 — thin-pack / footnote availability inputs. */
function academicStyleOptions(
  sources: DrafterInputSource[],
  sufficiency?: SufficiencyAssessment,
): { limitedDraft: boolean; hasFootnotes: boolean } {
  const limitedDraft = (sufficiency?.reason ?? "").includes("academic_writing_draft_allowed") ||
    sufficiency?.limited_doctrinal_answer === true ||
    sources.length <= 2;
  return { limitedDraft, hasFootnotes: sources.length > 0 };
}



/** academic_writing_intent_and_drafting_v1 — single post-draft note when the
 * draft was produced under thin sourcing. */
export const ACADEMIC_LIMITED_DRAFT_NOTICE_HE =
  "הטיוטה מנוסחת כטיוטה אקדמית ראשונית, ללא השלמת הפניות מלאות. יש להשלים בהמשך הפניות מדויקות לפסיקה ולספרות.";



import {
  planSynthesisRendering,
  reportSynthesisRendering,
  type SynthesisRenderingPlan,
  type SynthesisRenderingReport,
} from "./synthesisRendering.ts";



// drafterV2-only output-token budgets. Reasoning models (gpt-5 family) burn
// most tokens on hidden reasoning; the default gateway cap has been observed
// to cut Hebrew answers mid-word. These values reserve enough room for
// reasoning + a structured JSON tool call for a long legal answer.

/**
 * doctrinal_sufficiency_telemetry_persistence_v1 — telemetry only.
 * Deterministic branches return before claimSourceMatch runs. Emit an explicit
 * stage_not_run marker instead of leaving the field null, so a validation run
 * can always be attributed to a stage.
 */
function claimSourceMatchNotRun(branch: string): ClaimSourceMatchReport {
  return {
    applied: false,
    stage_not_run: true,
    stage_not_run_reason: `deterministic_branch:${branch}`,
    source_ref_mismatch_count: 0,
    dropped_source_refs: [],
    mismatch_reason: [],
    unsupported_block_count: 0,
    limitation_added: false,
    primary_support_by_main_claim: false,
    commentary_only_claims: [],
    tagged_block_count: 0,
    claim_categories: [],
    authority_overstatements: [],
    secondary_supported_block_count: 0,
    primary_supported_block_count: 0,
  };
}

const DRAFTER_V2_BUDGET_INITIAL = 8000;
const DRAFTER_V2_BUDGET_RETRY = 16000;


const SYSTEM_PROMPT_V2 = `אתה משפטן/ית ישראלי/ת הכותב/ת מענה משפטי־מחקרי מדויק, בהיר ומבוסס מקורות בעברית, בהיקף המתאים לשאלה. התשובה מיועדת למשפטן/ית, סטודנט/ית למשפטים או חוקר/ת משפט, ולכן עליה לשלב עומק משפטי עם ניסוח טבעי וברור — לא כתיבה פרקטית מדי, ולא סגנון אקדמי מתורגם או מנופח.

חשוב מאוד — פורמט פלט מבני (לא Markdown חופשי):
- אתה מחזיר *רק* קריאה לכלי emit_structured_draft עם אובייקט {blocks: [...]}.
- כל פסקה היא בלוק נפרד מסוג "paragraph" עם שדה text ושדה source_refs.
- כותרות הן בלוק "heading" (level 2 או 3) עם שדה text בלבד, ללא source_refs.
- פריט רשימה הוא "list_item" עם text ו-source_refs.
- בשדה text **אסור בהחלט** לכלול ספרות עליונות (¹²³…), אסור [N] בסוגריים מרובעים, אסור [[fn:N]], ואסור כל סימן הערת שוליים שהוא. הקוד מוסיף את הסימנים אחר־כך — אם תוסיף סימנים בעצמך, התשובה תיפסל לחלוטין.
- source_refs מכיל מזהי מקור כפי שניתנו לך (s1, s2, s3, … או u1p1 וכד'). מותרים אך ורק מזהים שהופיעו ברשימת המקורות. אם תפנה למזהה שלא קיים — התשובה תיפסל.
- אם פסקה היא פתיחה כללית, מעבר, או מסקנה שאינה מוסיפה טענה משפטית חדשה, אפשר source_refs: [].
- אם כמה מקורות תומכים בטענות שונות באותה פסקה — הוסף את כולם ל-source_refs של אותו בלוק, לפי סדר המשפטים שהם תומכים בהם. הקוד ימקם הערת שוליים נפרדת ליד המשפט המתאים. רק כאשר שני מקורות תומכים בדיוק באותה טענה בודדת תיווצר הערה מורכבת אחת.
- אל תוסיף את אותו מקור פעמיים באותו בלוק.
- מקסימום 3 מקורות לבלוק (אם נדרשים יותר — פצל לשני בלוקים נפרדים).

סגנון לשוני (גובר על כל כלל סגנוני אחר; אינו גובר על דיוק משפטי, על נאמנות למקורות, ועל כללי הציטוט):
כתוב/י בעברית משפטית־אקדמית ישראלית טבעית. מותר וברצוי להשתמש במונחים תיאורטיים, דוקטרינריים והשוואתיים כאשר השאלה או המקורות מצדיקים זאת, אך הסבר/י אותם בבהירות. העדף/י מושג משפטי מקובל על פני מילה מרשימה אך עמומה. אל תמציא/י שמות עצם מופשטים או צירופים מלומדים שאינם קיימים בעברית משפטית — למשל "מכניזמים משפטיים", "פורמליזציה מדודה", "עמידות חוקתית", "מעמד על־תיקתי", "מרכיבי זהות מדגמית", "סיגנוניהם המשמעיים". אם אין בעברית המשפטית מונח מקובל לרעיון, הסבר/י אותו במשפט פשוט במקום להמציא צירוף. אל תתרגם/י ניסוחים משפטיים מאנגלית מילה־במילה. הסקירה צריכה להישמע כמו סקירה משפטית־אקדמית טובה של משפטן ישראלי — לא כמו מאמר אקדמי מתורגם, ולא כמו מכתב פרקטי לעורך דין.

כללי כתיבה משפטית — סגנון:
- **מענה ממוקד מההתחלה:** הפסקה הראשונה צריכה לגעת ישירות בלב השאלה. ניתן לפתוח בפסקת מסגור קצרה כאשר השאלה תיאורטית או השוואתית ודורשת הקשר, אך אין לפתוח בהקדמה גנרית על התחום.
- **עברית משפטית טבעית:** כתוב/י כפי שמשפטן/ית ישראלי/ת מנוסה היה/יתה כותב/ת סקירה משפטית. הימנע/י מתרגום מאנגלית, ממילים ריקות ומניסוחים מלאכותיים.
- **ודאות מדויקת:** הבחן בין מסקנה מבוססת, מגמה רווחת, ואי־ודאות. אל תרכך מה שהמקורות תומכים בו ישירות, ואל תקבע מה שאין לו תמיכה.
- **דיוק בין סוגי מקורות:** הבחן/י בין חוק, פסיקה, הנחיה מנהלית וספרות. אל תזכיר/י דוקטרינה או הלכה שאינה נדרשת לתשובה.
- **מבנה מותאם:** השתמש/י בבלוק heading רק כשהוא באמת מסייע לקורא במעבר בין נושאים מובחנים. אל תוסיף/י כותרת לכל פסקה ואל תפצל/י לכותרות־משנה (level 3) ללא צורך ממשי. תשובה של מספר פסקאות בנושא אחד בדרך כלל אינה זקוקה לכותרות.
- **המקורות משרתים את הטיעון:** אל תארגן את התשובה כסקירת מקורות. שלב כל מקור בטענה שהוא תומך בה, באמצעות source_refs של אותו בלוק.
- **אורך מותאם:** כתוב/י בהרחבה כאשר השאלה מורכבת או כשהמקורות מצדיקים זאת. אל תקצר/י על חשבון עומק משפטי, הבחנות דוקטרינריות, חריגים, דוגמאות או עוגנים משפטיים קונקרטיים. מצד שני, אל תאריך/י באמצעות חזרות, פתיחים גנריים, או ניסוחים מרשימים אך ריקים. אין יעד אורך קבוע — האורך נגזר מעומק השאלה ומעושר המקורות.

דיוק קונקרטי ושימור עוגנים משפטיים (קריטי):
- בעת ניסוח התשובה, **אל תחליף עוגנים משפטיים קונקרטיים בהפשטה כללית**. אם אחד המקורות תומך בפסק דין מרכזי, דוגמה פסיקתית, הוראת חוק או סעיף ספציפי, חריג, מבחן משנה, הבחנה משפטית, סוג סעד, נטל ראייתי או הבחנה בקשר סיבתי, או שאלה שנותרה פתוחה — שלב זאת בגוף התשובה במפורש, ולא כתקציר מופשט.
- תשובה טובה אינה רשימת יסודות מופשטת או "תקציר מילוני"; עליה לשמר את העוגנים המשפטיים שמעניקים לדין את הדיוק והניואנס שלו (שמות הלכות מרכזיות כשהן מופיעות במקורות, סעיפי חוק קונקרטיים, חריגים מוכרים, דרישות יסוד נפשי לפי המקור, הבחנות בין סעדים, נטלי הוכחה, ושאלות שטרם הוכרעו).
- עדיף לכלול דוגמה פסיקתית אחת קונקרטית או הבחנה משפטית מדויקת אחת מאשר לסכם את כל הדוקטרינה בשורה מופשטת.
- אין צורך להאריך לשם הארכה, ואין צורך להפחית מקורות לשם הפחתה. מספר המקורות לבלוק נגזר מהטענה — בלוק יכול לצטט מספר מקורות כאשר הם תומכים יחד באותה טענה (למשל חוק + פסיקה + ספרות).
- שמור על עברית משפטית טבעית גם כשאתה משלב עוגנים קונקרטיים — אל תהפוך את התשובה לרשימה טכנית או למבנה JSON־כמו.
- כאשר השאלה תיאורטית, חוקתית או השוואתית — מותר ורצוי לפתח טיעון תיאורטי או השוואתי, כל עוד הוא עוגן בעוגנים קונקרטיים מהמקורות ולא בהפשטות כלליות.

כללים נוספים:
- השתמש אך ורק במקורות שסופקו. אל תמציא חוקים, פסקי דין, סעיפים, שנים, או מחברים.
- אל תזכיר מזהים פנימיים (candidate_id, claim_id, C1, S1) בשום text.
- אל תכתוב כותרות עם # ## ###. כותרות יוצגו כ-bold דרך בלוק heading.
- כל הפניה למקור נעשית אך ורק דרך source_refs. אסור לכתוב "ראו s2" או "לפי מקור 3" בתוך text.

איכות לשונית, דיוק משפטי והגנה מפני זליגה פנימית:
כתוב בעברית משפטית ישראלית טבעית, כפי שעורך דין ישראלי היה מנסח. אל תמציא מונחים, אל תתרגם ביטויים משפטיים מאנגלית מילה־במילה, ואל תייצר שמות פעולה או צירופים שאינם מקובלים בשפה המשפטית. אם אינך בטוח שמונח מסוים קיים בעברית משפטית תקינה — העדף ניסוח פשוט וברור.

אין לכלול בתשובה ביטויים שבורים או מומצאים כגון: בשן טוב, לא להתאזר בסבירות, הודו-נתונה סמכות חוקית, תקנן הסביר, הגנה ההופכת, הכלתנייתיות, אפסון נזיקין, סעדין ניתנים, כברות של נאשם אחר.

השתמש במונחים משפטיים לפי ההקשר: גזר דין מתאים להליך פלילי ולשלב הענישה; בהקשרים אזרחיים או מנהליים העדף לפי הצורך פסק דין, החלטה, סעד, פיצוי, תרופה או הכרעה.

אין להוציא קטעים קטועים או תוויות מקור חלקיות בתוך גוף התשובה. אל תכתוב דו., והדו., הדו., הספרות והדו., או קיצור שנקטע באמצע. אם אתה מתכוון לדוח, כתוב דוח, דין וחשבון, או שם מקור ברור, והצמד את המקור דרך source_refs.

אין לכלול בתשובה תוויות פנימיות או מזהים פנימיים כגון C1, C2, שאלה C2, claim_id, candidate_id, s1, u1p1, או כל מזהה שנראה כמו scaffold פנימי.

שמור על מסגרת השאלה של המשתמש. אם המקורות עוסקים בנושא סמוך אך לא זהה, ציין זאת בזהירות ואל תחליף את שאלת המשתמש בנושא של המקורות. לדוגמה, אם המשתמש שאל על גביית דמי חסות / פרוטקשן והמקור עוסק בצווי הגנה, אל תהפוך את התשובה לשאלה על צווי הגנה; השתמש במקור רק כרקע או ציין שמדובר במקור סמוך.

כתיבה אקדמית־משפטית אמיתית רצויה כאשר השאלה דורשת זאת; כתיבה פסבדו־אקדמית, מתורגמת או עמומה — אינה רצויה לעולם. ההבדל: כתיבה אקדמית טובה מסבירה רעיון תיאורטי במונחים מקובלים ובדוגמאות; כתיבה פסבדו־אקדמית מחביאה רעיון פשוט בצירופי שמות עצם מופשטים.

חיזוק איכות לשונית — עברית משפטית נקייה, שמות רשמיים, ותוויות בעלי דין (חובה):
- אל תמציא מילים בעברית ואל תייצר צורות נטייה מומצאות. אם אינך בטוח שהצירוף קיים בעברית משפטית — נסח בפשטות במונח מקובל.
- אל תכניס מילים לועזיות (אנגלית, ספרדית, לטינית וכד') לתוך תשובה בעברית, אלא אם מדובר במונח משפטי מקובל וכשהשימוש בו הכרחי. אל תכתוב alcance, scope, due process וכד' בתוך משפט עברי — השתמש ב"היקף", "הסמכות", "הליך הוגן" וכיו"ב.
- שמות חוקים רשמיים — בדיוק כפי שהם. למשל: "חוק-יסוד: כבוד האדם וחירותו" — לא "חוק-יסוד של כיבוד האדם והחירות", לא "כיבוד האדם והחירות", לא וריאציות אחרות. שמור על נקודתיים, יידוע ונטיות מדויקות.
- תוויות בעלי דין לפי הקשר ההליך:
  - הליך אזרחי / נזיקי: "תובע" ו"נתבע". אסור "נאשם" בהקשר אזרחי.
  - הליך פלילי: "המאשימה" ו"נאשם".
  - הליך מנהלי / עתירה: "עותר" ו"משיב".
- אל תמציא צירופים סביב סמכות מנהלית. כתוב "הבטחה מנהלית", "הרשות המוסמכת", "בעל הסמכות" — לא "הבטחה מנהירת סמכויות", לא "המשרוק", לא ניסוחים דומים שאינם קיימים בעברית משפטית.
- העדף עברית משפטית פשוטה ונכונה על פני ניסוח מרשים-לכאורה. אל תשתמש בביטויים כמו "מום פרשני", "שווה לנקוט", "משקל תקף נמוך יותר" וכיו"ב — בחר במונח מקובל ("פגם פרשני", "ראוי לנקוט", "משקל נמוך יותר") או נסח מחדש.

חוזה ראיות וכיול ודאות (חובה — גובר על נטייה לכתיבה החלטית):
- לכל מקור בשדה "support" מצוין direct או partial. כתוב בהתאם:
  • direct — מותר לנסח את הטענה הספציפית שאותו מקור תומך בה בצורה ברורה.
  • partial / mixed / generic_index — חובה ניסוח זהיר. אל תקבע מסקנה גורפת על בסיס כזה.
- טענות מן הסוגים הבאים אסור להציגן בלשון חזקה אלא אם יש להן תמיכה direct ספציפית באותם מקורות: המלצות רחבות לרפורמה או קודיפיקציה, קביעות חוקתיות, קביעות על "השפעה מעשית" רחבה בפועל, קביעות על המגמה הכוללת של הפסיקה, וקביעות "המקורות מוכיחים".
- לטענות בעלות תמיכה חלקית או מעורבת, השתמש בניסוחים זהירים בלבד: "מן המקורות עולה בזהירות כי", "ניתן להצביע על", "אפשר לטעון כי", "המקורות מצביעים על מגמה", "אין במקורות שאותרו כדי לבסס מסקנה נחרצת".
- אל תשתמש בלשון חזקה כגון "מכאן נובע", "ברור כי", "הדבר מחייב", "המסקנה היא", "יש לקבוע", "המקורות מוכיחים" — אלא אם יש תמיכה direct ספציפית.

סגנון עברי משפטי נקי (חובה):
- כתוב בעברית משפטית טבעית ומקובלת. העדף ניסוח משפטי ברור על מילים פסבדו-אקדמיות שאינן קיימות.
- אל תכתוב את הצורות השגויות הבאות: "פוקודה" (הצורה הנכונה: "פקודה"), "המסקנהיות", "כלים עיליים", "הדין הפרשני האקטיבי", "כלי עובדני".

כותרות והערות שוליים מורכבות:
- צמצם משמעותית כותרות. אל תיצור heading לכל פסקה. מספר פסקאות באותו נושא בדרך כלל אינן זקוקות לכותרת.
- העדף source_ref אחד מדויק לפסקה. שניים — רק כשבאמת נדרש. שלוש — רק כאשר כל אחד מהמקורות באמת תורם משהו שונה (חוק + פסיקה + ספרות).
- הימנע מ"מרק מקורות" — אל תצרף שלושה מקורות לפסקה רק כדי "לחזק" אותה.

רמז מבנה תשובה (answer_intent) — כאשר הודעת המשתמש כוללת שורת "מבנה מבוקש (רמז פורמט)", יש להתייחס אליה כרמז פורמט מנחה בלבד. היא אינה משנה את מדיניות הביטחון או ההסתייגויות — אלו נגזרות מהראיות בפועל (עוגן חסר, תמיכת הוורייפייר, נוכחות/היעדר הסניפט הרלוונטי). כללי המבנה לפי output_shape:
   • quote — אם הטקסט המבוקש מופיע כלשונו בסניפט של אחד המקורות שסופקו, ציטט אותו verbatim בתוך בלוק paragraph או list_item עם source_ref למקור. אין לבקש מהמשתמש להזמין את הציטוט שוב ואין להפנות אותו לבירור נוסף. אם המקור הרשמי מופיע ברשימה אבל הטקסט המדויק לא חולץ אל תוך הסניפט, כתוב במפורש: "המקור הרשמי אותר אך הטקסט המדויק לא חולץ ממנו, ולכן אינו מובא כאן בציטוט מדויק" — ואל תמציא ניסוח דמוי-ציטוט.
   • definition — פתח את התשובה בהגדרה או ביסודות כפי שהם מופיעים במקור הראשוני, לפני מסגור כללי או רקע.
   • list — הצג את הפריטים כ-list_item קונקרטיים. אם יש עיתוי/מועד רלוונטי לפריט מסוים והוא מופיע במקורות, שבץ אותו בפריט עצמו ולא במשפט כללי בסוף.
   • timeline — הצג ימים/מועדים/תקופות כפריטי list_item עם המספרים הקונקרטיים מהמקורות. אם לוחות הזמנים לא חולצו אל תוך הסניפטים, ציין זאת במפורש; אין להמציא ימים או מועדים.
   • case_holding — כאשר פסק הדין הספציפי מופיע במקורות המאומתים, נסח את ההלכה/הרציו של אותו תיק ישירות. כאשר פסק הדין עצמו חסר (וקיים בלוק "הערה קריטית" על עוגן חסר), פעל לפי אותו בלוק — אל תייחס לתיק הספציפי קביעות שאינן במקורות שסופקו. אין לגזור מהרמז הזה, כשלעצמו, לא סירוב ולא ביטחון — עצם השאלה על תיק ספציפי היא שקובעת את הצורה.
   • analysis / comparison — התנהג כרגיל, אך הטה את המבנה בהתאם (דיון רציף מול השוואה מובנית).

מקור מוביל (lead_ref) — אם הודעת המשתמש כוללת שורת "lead_ref: sN", זהו המקור הסמכותי שמוביל את התשובה. פתח ממנו: בפסק דין — ההחזקה וההנמקה; בחוק/תקנה — לשון ההוראה, ההגדרה או החובה. מקורות המסומנים תחת "secondary_refs" משמשים רק לניואנס, הקשר, ביקורת או הרחבה, ואינם מחליפים את המקור המוביל. חשוב: כאשר output_shape הוא case_holding וקיים lead_ref — הבלוק הראשון שמנסח את ההלכה או את הרציו של פסק הדין חייב לכלול את lead_ref ב-source_refs (לבדו או כמקור הראשון); אין להסתפק במקורות רקע/חקיקה כתמיכה יחידה למשפט ההלכה. כאשר אין שורת lead_ref — התנהג כרגיל.

חשוב: השאלה מה מותר לומר בביטחון ומתי חובה להסתייג ממשיכה להיגזר מהמקורות בפועל ומ"חוזה הראיות" למעלה — לא מ-answer_intent. הרמז הזה משפיע על *הפורמט*, לא על *רמת הוודאות*.

חדות משפטית (כללי ניסוח מחייבים):
1. **שורה תחתונה בפתיחה:** כאשר output_shape הוא case_holding, definition או list — המשפט המהותי הראשון בתשובה חייב לומר את התשובה המשפטית עצמה, למשל "בית המשפט קבע כי…", "הסעיף קובע כי…", "הצעד הראשון הוא…". אין לפתוח במגבלות מקורות, בתיאור תהליך המחקר או בהסתייגות — אלא אם התשובה כולה היא סירוב/מגבלה דטרמיניסטית שנמסרה לך במפורש. הסתייגות בדבר היקף המקורות תמוקם בסוף התשובה.
2. **תקציב הסתייגויות לפי עוצמת התמיכה:** טענה הנשענת על מקור בתמיכה ישירה תנוסח באופן ישיר וחד. הימנע מביטויים כגון "עולה בזהירות", "ניתן להסיק בזהירות", "מן המקורות עולה בזהירות", "יש להתייחס בזהירות". מותרת לכל היותר הסתייגות אחת בכל התשובה, ורק כאשר התמיכה חלקית/משיקית או שקיים פער מקורות אמיתי. אין להסתייג ביחס לדין מושרש או להלכה/הוראת חוק הנתמכות ישירות.
3. **פרוזה משפטית ולא פרוזת מחקר:** אסור לכתוב "מן החומר שבדקתי", "המקורות שסופקו", "מן המקורות עולה", "החומר שנמסר", "מוצג כמקור מרכזי". במקומם השתמש בייחוס משפטי: "נקבע כי", "הסעיף קובע כי", "הפסיקה קובעת כי", "לפי ההלכה", "הדוקטרינה המרכזית היא".
4. **מונחים משפטיים מקובלים:** כאשר המקורות תומכים בדוקטרינה מוכרת — נקוב בשמה המקובל במפורש (למשל: מבחן ההשתלבות, המבחן המעורב, פיצויי הסתמכות, פיצויי קיום, הרמת מסך, סמכות מכוננת), ואל תדלל אותה לתיאור גנרי.

זכור: אם תכניס סימן עילי כלשהו לתוך text, התשובה תיפסל.`;



const DRAFTER_V2_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["heading", "paragraph", "list_item"] },
          level: { type: "integer", enum: [2, 3] },
          text: { type: "string", minLength: 1 },
          source_refs: {
            type: "array",
            items: { type: "string" },
          },
          claim_id: { type: "string" },
          facet_id: { type: "string" },
          proposition_type: {
            type: "string",
            enum: [
              "black_letter_rule",
              "application",
              "background",
              "practical_guidance",
              "limitation",
            ],
          },
          legal_area: { type: "string" },
          claim_category: {
            type: "string",
            enum: [
              "court_holding",
              "statutory",
              "doctrinal_synthesis",
              "scholarly_commentary",
              "contextual_background",
            ],
          },
        },
        required: ["kind", "text"],
        additionalProperties: false,

      },
    },
  },
  required: ["blocks"],
  additionalProperties: false,
};

/**
 * source_use_intent_planning_v1 — internal source ids (s1, s3, ...) are a
 * prompt-only addressing scheme. Recommendation-style answers occasionally
 * leak them into prose; footnote markers are the only user-facing reference.
 */
function stripInternalRefTokens(text: string): string {
  return text
    .replace(/\s*\((?:\s*s\d{1,2}\s*)(?:,\s*s\d{1,2}\s*)*\)/g, "")
    .replace(/\s*\[(?:\s*s\d{1,2}\s*)(?:,\s*s\d{1,2}\s*)*\]/g, "")
    // Internal block tags the model sometimes echoes into the prose.
    .replace(
      /\s*\((?:claim_id|facet_id|proposition_type|claim_category)\s*:[^()]{0,200}\)/g,
      "",
    );
}


function buildUserMessage(
  question: string,
  claims: Claim[],
  sources: DrafterInputSource[],
  userDocs: UserDocument[],
  useAsSource: boolean,
  missingAnchors: Array<{ description: string; is_docket?: boolean; is_statute_section?: boolean }>,
  answerIntent?: AnswerIntent,
  leadRef?: string | null,
  sufficiency?: SufficiencyAssessment,
  framing?: NamedDoctrineFraming,
  synthesisRendering?: SynthesisRenderingPlan,
  facetDirective?: string[],
  blockCeiling?: number | null,
  sourceUsePlan?: SourceUsePlan | null,
  claimSourcePlan?: ClaimSourcePlan | null,
  representativeSources?: RepresentativeSourceReport | null,
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push(
    "מסגרת התשובה חייבת להישאר נאמנה לשאלה כפי שנשאלה. אם המקורות עוסקים בנושא סמוך אך לא זהה — ציין זאת במפורש ואל תחליף את שאלת המשתמש.",
  );
  const academicWriting = planRequestsAcademicWriting(sourceUsePlan);
  const academicPrimary = sourceUsePlan?.user_task_intent === "academic_writing";
  if (academicPrimary) {
    // Academic drafts must not use retrieval-scoped phrasing about the user's
    // own topic concepts; non-existence claims are still forbidden.
    lines.push(
      'אין לקבוע שדוקטרינה/הלכה "אינה קיימת" או ש"אין הלכה מוכרת בשם זה". מונחים שהמשתמש עצמו הציג (למשל "עקרון הפרדת הרשויות") הם חלק מנושא העבודה — יש להתייחס אליהם כמסגרת המחקר ולא כטענות הדורשות עיגון.',
    );
  } else {
    lines.push(NEGATIVE_EXISTENCE_PROMPT_RULE);
  }
  if (academicWriting) {
    const genre = sourceUsePlan?.academic_genre ?? "generic_academic";
    lines.push("");
    lines.push(
      "משימת כתיבה אקדמית: המשתמש ביקש טקסט אקדמי מוכן — לא דוח מחקר ולא דיווח על מקורות. הפק פרוזה אקדמית עברית רציפה, זהירה וטבעית, בז׳אנר המבוקש.",
    );
    if (genre === "chapter_outline") {
      lines.push(
        "הז׳אנר המבוקש הוא מתווה/מבנה — כאן מותרת רשימה מסודרת של פרקים עם תיאור קצר לכל פרק.",
      );
    } else {
      lines.push(
        "אין להשתמש ברשימות תבליטים או בכותרות-משנה תבניתיות — כתוב פסקאות פרוזה רציפות. מותר ואף רצוי לחלק את הטקסט לכמה פסקאות פרוזה רגילות לצורך קריאוּת, אך לא לרשימות (רשימה מותרת רק אם המשתמש ביקש מפורשות מתווה/רשימה).",
      );
    }
    if (genre === "introduction") {
      lines.push(
        "לפרק מבוא כלול, במידת הצורך: מסגור הבעיה המשפטית, רקע דוקטרינלי, שאלת המחקר, המתח המרכזי, חשיבות השאלה, ומבנה העבודה המתוכנן.",
      );
    }
    if (genre === "argument_paragraph") {
      lines.push(
        "הז׳אנר המבוקש הוא פסקת טיעון אחת: כתוב פסקה אקדמית ממוקדת אחת בלבד (כ-150–300 מילים) שמשיבה ישירות לטענה שהמשתמש ביקש לבסס. אין לפצל לפרקים או לכותרות, ואין להכניס דוגמאות, הקשרים מוסדיים או תתי-נושאים שהמשתמש לא הזכיר.",
      );
      lines.push(
        "מבנה הפסקה: הצגת הטענה; הצגת הטיעון הנגדי החזק ביותר בניסוחו המיטבי; אבחנה משפטית מדויקת בין השניים; והכרעה — או הודאה מפורשת בקושי שנותר. אין לבטל את הטיעון הנגדי במשפט אחד.",
      );
    }

    // academic_drafter_prompt_conflict_cleanup_v1 — the structured-block
    // contract makes the model draft each paragraph as a self-contained unit,
    // which reads like a list. Demand continuity explicitly.
    lines.push(
      "כתוב את התשובה כטקסט אקדמי רציף. גם אם מבחינה טכנית התשובה מורכבת מבלוקים, כל פסקה צריכה להמשיך את קודמתה ולא להיפתח מחדש כאילו היא פריט ברשימה.",
    );
    lines.push(
      "מיקוד נושאי: המקורות שאותרו נועדו להעשיר את הנושא שהמשתמש הגדיר בלבד. אין לגלוש להקשרים דוקטרינריים קונקרטיים אחרים (למשל בתי דין דתיים בשאלה על מינויים פוליטיים) אלא אם המשתמש הזכיר אותם. מקור מתחום אחר מותר רק כמסגרת תיאורטית/השוואתית כללית, ורק אם אינו מוצג כסמכות ישירה לנושא הספציפי.",
    );
    lines.push(
      "אין לכתוב כתובות URL בגוף הטקסט. הפניות למקורות יופיעו בהערות השוליים בלבד.",
    );


    // academic_style_model_v1 — the style guide owns prose quality; the drafter
    // keeps only safety, source-support, envelope and citation rules.
    const styleGuide = buildAcademicStyleGuideBlock(
      genre as AcademicGenre,
      academicStyleOptions(sources, sufficiency),
    );
    if (styleGuide.block) {
      lines.push(
        'אין לפזר הערות זהירות בגוף הטקסט — אם נדרשת הבהרה, היא תופיע כהערה קצרה אחת לאחר הטיוטה בלבד.',
      );
    } else {
      lines.push(
        'אין לפתוח את הטיוטה בדיווח על המקורות (למשל "במקורות שאותרו לא נמצא…", "לא נמצא עיגון מספק…"). אין לפזר הערות זהירות בגוף הטקסט — אם נדרשת הבהרה, היא תופיע כהערה קצרה אחת לאחר הטיוטה בלבד.',
      );
    }
    lines.push(
      "אין לייחס לבית משפט הלכה ספציפית ללא גוף פסק דין שאותר, אין להמציא הפניות, ואין לצטט מקורות שאותרו בלבד. כשהתמיכה דלה — נסח בלשון זהירה ובמונחים כלליים.",
    );
    if (styleGuide.block) {
      lines.push("");
      lines.push(styleGuide.block);
    }

    // academic_drafter_source_ref_coverage_v2 — light citation-use section for
    // the short / generic genres (they receive no citation section from the
    // style guide), plus role→block steering derived from pack metadata.
    if (LIGHT_CITATION_GENRES.includes(genre as AcademicGenre)) {
      lines.push("");
      lines.push(buildLightCitationUseBlock(genre as AcademicGenre));
    }
    const roleMapBlock = renderSourceRoleMapBlock(
      buildAcademicSourceRoleMap(question, sources),
    );
    if (roleMapBlock) {
      lines.push("");
      lines.push(roleMapBlock);
    }
  }


  if (framing?.framing_correction_required && framing.named_doctrine_phrase) {
    const named = framing.named_doctrine_phrase;
    const subject = framing.subject_phrase ?? named;
    lines.push("");
    lines.push(
      `הערה קריטית — תיקון מסגור (premise): המשתמש ניסח את השאלה כאילו קיימת הלכה/דוקטרינה בשם "${named}", אך אף מקור בר-ציטוט מבין אלה שסופקו לך אינו משתמש בשם הזה. זהו ממצא על המקורות שאותרו בלבד — ולא קביעה שהדוקטרינה אינה קיימת. המקורות כן עוסקים במוסד/הסדר משפטי אמיתי בעניין "${subject}".`,
    );
    lines.push(
      `לכן מבנה התשובה חייב להיות, בסדר הזה: (1) משפט פתיחה שקובע במפורש שבמקורות שאותרו לא נמצא עיגון מספק לשם "${named}" (ניסוח מחייב: "במקורות שאותרו לא נמצא עיגון מספק ל…"), בלי לקבוע שההלכה אינה קיימת; (2) משפט שמזהה את ההסדר/המוסד המשפטי הקרוב שכן קיים לפי המקורות (למשל הוראת חוק ספציפית) ונוקב בשמו ובמקורו; (3) גוף התשובה — הדין לגבי אותו הסדר, רק ככל שהמקורות תומכים בו; (4) משפט סיום שמזמין את המשתמש לחדד אם התכוון להלכה אחרת או להעלות מקור.`,
    );
    lines.push(
      `אין לפתוח בכותרת או במשפט שמציג את "${named}" כהלכה מוכרת, ואין להשתמש בניסוחים כמו "הפסיקה מכירה בהלכת…" ביחס לשם הזה. במקביל אין לכתוב או לרמוז ש"אין הלכה מוכרת בשם זה", ש"לא קיימת הלכה כזו" או שהדוקטרינה אינה קיימת — הניסוח חייב להיות מוגבל למקורות שאותרו. כלל התיקון הזה גובר על כלל "שורה תחתונה בפתיחה".`,
    );
  }
  if (sufficiency?.statute_only_answer) {
    lines.push("");
    lines.push(
      "בסיס הסמכות לתשובה הזו הוא חקיקה/תקנות בלבד — לא נמצאו פסקי דין ברי-שימוש בנושא. נסח את התשובה על בסיס הוראות החוק והתקנות שסופקו לך בלבד.",
    );
    lines.push(
      "אין להמציא פסקי דין, אין לייחס הלכות לבתי משפט, ואין להישען על ספרות/פרשנות כמקור סמכות ראשי. ציין במפורש, במשפט קצר, שלא מוצגת כאן סקירת פסיקה משום שלא נמצאו פסקי דין ברי-שימוש. שמור את התשובה בגבולות מה שהחוק/התקנות תומכים בו.",
    );
  }
  if (sufficiency?.limited_doctrinal_answer) {
    lines.push("");
    lines.push(
      "היקף סמכות מוגבל: לא אותר נוסח פסק דין מחייב בסוגיה. בסיס התשובה הוא חקיקה שאותרה ו/או ספרות משפטית, " +
        "פרשנות או חומר מוסדי שנקראו במלואם. מותר להסביר את המסגרת הדוקטרינרית, את הסיווג המקובל ואת עמדות הכתיבה המשפטית — " +
        "והכל תוך ייחוס מדויק לרמת הסמכות של המקור.",
    );
    lines.push(
      "אסור להציג קביעה הנשענת על ספרות או פרשנות כהלכה מחייבת, ככלל פסיקתי מוגמר או כתוצאה של פסק דין מסוים; " +
        "אסור לייחס הלכה לבית משפט ללא נוסח פסק דין שסופק לך; ואסור להמציא פסקי דין או להסתמך על אזכורי כותרת בלבד. " +
        "אם היקף המקורות אינו מאפשר תשובה מלאה — כתוב תשובה מוגבלת וכנה במקום להרחיב.",
    );
  }
  if (sufficiency?.limited_doctrinal_answer_allowed) {
    lines.push(
      "התשובה כאן היא הסבר דוקטרינרי מוגבל הנסמך על ספרות משפטית שנקראה במלואה בלבד. הסבר את הדוקטרינה כפי שהיא משתקפת בכתיבה המשפטית — יסודות מקובלים, רציונלים, מתחים וגבולות — וציין במפורש שלא אותר נוסח פסק דין מחייב או נוסח חוק רשמי שנקרא במלואו. סיים בהכוונה קצרה לאילו מקורות ראשוניים כדאי לפנות לאימות.",
    );
    lines.push(
      "אין לכתוב \"בית המשפט קבע\" או ניסוח שווה ערך, אין לצטט או לשחזר נוסח סעיף חוק, ואין להציג את הספרות כמקור סמכות מחייב.",
    );
  }
  if (sufficiency?.practical_steps_thin_authority_passed) {
    lines.push("");
    lines.push(
      "בסיס הסמכות כאן הוא חקיקה/תקנות רלוונטיות שאותרו, אך ללא נוסח מלא. פתח או סיים במשפט הבא כלשונו: \"המקורות שאותרו הם חקיקה/תקנות רלוונטיות, אך לא אותר נוסח מלא/פסיקה ישירה במקורות ששימשו כאן.\"",
    );
    lines.push(
      "אין לצטט נוסח סעיפים, אין לנקוב בסכומים מדויקים, בסכום תביעה מרבי, בשיעורי אגרה או במועדים/מועדי התיישנות — אלא אם קיים בפועל טקסט מקור התומך בהם. במקום זאת ציין את מסגרת ההסדר ואת המקור שבו יש לוודא את הנתון המעודכן. אין להשתמש בספרות/פרשנות כמקור סמכות ראשי.",
    );
  }
  if (sufficiency?.exact_amounts_allowed === false && !sufficiency?.practical_steps_thin_authority_passed) {
    lines.push(
      "אין לנקוב בסכומים, אגרות או מועדים מדויקים ללא טקסט מקור מפורש התומך בהם.",
    );
  }
  if (sufficiency?.thin_source) {
    lines.push(
      "הערת דלילות מקורות: הטקסט התומך שנמצא קצר ואינו כולל נוסח מלא של ההלכה/ההוראה. נסח את התשובה על בסיס מה שקיים בפועל, והוסף בסוף הסתייגות קצרה שלפיה טקסט ההלכה המלא לא היה בידיך.",
    );
  }

  if (synthesisRendering?.applied) {
    for (const l of synthesisRendering.directive_lines) lines.push(l);
  }

  // claim_facet_expansion_v1 — facet-scoped structure + footnote discipline.
  if (facetDirective && facetDirective.length > 0) {
    for (const l of facetDirective) lines.push(l);
  }

  // router_profiles_v1 — per-path block ceiling. Light paths must say less,
  // not pad: a block without a verified source should be omitted entirely.
  if (blockCeiling && blockCeiling > 0) {
    lines.push(
      `מגבלת אורך (מסלול תשובה): החזר לכל היותר ${blockCeiling} בלוקים. ` +
        "אל תמלא מכסה: אם אין מקור מאומת לקביעה — השמט את הבלוק במקום לנסח פסקה ריקה או לחזור על מה שכבר נאמר. " +
        "אין לחזור על אותה קביעה בניסוח אחר.",
    );
  }





  const missingDocketAnchors = missingAnchors.filter((a) => a.is_docket);
  const missingStatuteSectionAnchors = missingAnchors.filter((a) => a.is_statute_section);
  const missingNonDocketAnchors = missingAnchors.filter((a) => !a.is_docket && !a.is_statute_section);
  const shape = answerIntent?.output_shape;
  const statuteRefusalActive =
    missingStatuteSectionAnchors.length > 0 && (shape === "definition" || shape === "quote");
  if (missingNonDocketAnchors.length > 0) {
    lines.push("");
    lines.push(
      "הערה משפטית חשובה: עוגן ראשוני הבא נדרש לתשובה מלאה אך לא נמצא במקורות שסופקו לך:",
    );
    for (const a of missingNonDocketAnchors) lines.push(`  • ${a.description}`);
    lines.push(
      "בתשובתך, ציין במפורש שהעוגן הזה אינו בידיך וכי ניתוח ההמשכיות/החוקיות המלא דורש עיון בו, במקום להניח ממנו מסקנות חיוביות.",
    );
  }
  if (missingDocketAnchors.length > 0) {
    lines.push("");
    lines.push(
      "הערה קריטית — פסק הדין הספציפי שהמשתמש שאל עליו לא אותר במקורות שעברו אימות:",
    );
    for (const a of missingDocketAnchors) lines.push(`  • ${a.description}`);
    lines.push(
      'עליך לכלול בגוף התשובה, במפורש ובלשון כמעט זהה, את המשפט הבא: "לא אותר פסק הדין עצמו במקורות שעברו אימות; לכן לא ניתן לקבוע בביטחון את ההלכה שנפסקה בו." אין להציג מקורות רקע או פסיקה סמוכה כאילו הם ההלכה שנפסקה בתיק הספציפי הזה. מותר לתאר את ההקשר המשפטי הכללי בזהירות, אך לא לייחס לתיק ספציפי קביעות שאין להן תמיכה ישירה במקורות שסופקו.',
    );
  }
  if (statuteRefusalActive) {
    lines.push("");
    lines.push(
      "הערה קריטית — נוסח החוק הספציפי שנתבקש (הגדרה/ציטוט) לא אותר במקורות שעברו אימות:",
    );
    for (const a of missingStatuteSectionAnchors) lines.push(`  • ${a.description}`);
    lines.push(
      'עליך לכלול בגוף התשובה, במפורש ובלשון כמעט זהה, את המשפט הבא: "לא אותר במקורות שעברו אימות נוסח מוסמך של הסעיף המבוקש; לכן לא ניתן להביא את ההגדרה או הציטוט המחייב." אין לגזור את ההגדרה, את התנאים המצטברים או את הציטוט המבוקש מסעיפים אחרים, מחוזרים מנהליים, מהצעות חוק, ממאמרים או ממקורות משניים סמוכים. מותר להזכיר בקצרה את ההקשר הרגולטורי שהמקורות המשניים חושפים, אך אין להציג פרטים כמותיים (סכומים, סֵפים, אחוזים) או רשימת תנאים ולייחס אותם לסעיף המבוקש.',
    );
  } else if (missingStatuteSectionAnchors.length > 0) {
    // Non-definition/quote shape — softer note.
    lines.push("");
    lines.push(
      "הערה: נוסח הסעיפים הבאים לא אותר במקורות שעברו אימות, ולכן אין לייחס להם קביעות כמותיות או ניסוחיות מדויקות:",
    );
    for (const a of missingStatuteSectionAnchors) lines.push(`  • ${a.description}`);
  }
  lines.push("");
  lines.push("טענות (לשימוש פנימי בלבד — אל תזכיר מזהי טענות בשום text):");
  for (const cl of claims) {
    lines.push(`- (${cl.claim_id}) ${cl.text_he}`);
  }
  // topic_aware_claim_source_alignment_v1 — per-claim allowed/disallowed refs.
  if (claimSourcePlan) {
    const planBlock = renderClaimSourcePlanBlock(claimSourcePlan);
    if (planBlock) {
      lines.push("");
      lines.push(planBlock);
    }
    // canonical_registry_discovery_and_representative_source_use_v1 (fix 3) —
    // the representative-source obligation goes immediately after the plan.
    if (representativeSources) {
      const repBlock = renderRepresentativeSourceBlock(representativeSources, claimSourcePlan);
      if (repBlock) {
        lines.push("");
        lines.push(repBlock);
      }
    }
  }
  if (answerIntent) {
    lines.push("");
    lines.push(`מבנה מבוקש (רמז פורמט): ${answerIntent.output_shape}`);
  }

  // source_use_intent_planning_v1 — planned task guidance. Guidance, not a
  // template: no fixed headings, no fixed phrasing, proportional length.
  if (sourceUsePlan) {
    const p = sourceUsePlan;
    lines.push("");
    lines.push(
      `תכנון המשימה: המשתמש מבקש ${p.user_task_intent}; אסטרטגיית מענה: ${p.answer_strategy}` +
        (p.mixed_plan && p.secondary_task_intent
          ? `; משימה משנית: ${p.secondary_task_intent}`
          : ""),
    );
    if (p.mixed_plan) {
      lines.push(
        "זו שאלה מעורבת: ענה באופן טבעי ומידתי — תחילה המסגרת המשפטית מהמקורות הראשוניים, ולאחר מכן ההכוונה המחקרית/הספרותית. אין להשתמש בכותרות קבועות או בתבנית מוכתבת.",
      );
    }
    if (p.authority_requirements.requires_judgment_body) {
      lines.push(
        "השאלה מחייבת גוף פסק דין שאותר ואומת. אין לגזור את שנפסק ממקורות משניים, מסיכומים או מציטוטים עקיפים.",
      );
    }
    if (p.authority_requirements.requires_official_statute) {
      lines.push("קביעות לגבי נוסח או תוכן של חוק/סעיף חייבות להישען על טקסט חקיקה רשמי שאותר.");
    }
    if (p.source_use_intent.length > 0) {
      lines.push(`אופן השימוש המתוכנן במקורות: ${p.source_use_intent.join(", ")}.`);
    }
    lines.push(
      "הבחן בבירור בין מקורות שנקראו במלואם (ניתן להסתמך עליהם לקביעות מהותיות) לבין מקורות שאותרו בלבד — אלה מוצגים לכל היותר כמועמדים לקריאה נוספת ואינם יכולים לתמוך בשום קביעה משפטית.",
    );
    if (!p.authority_requirements.found_only_allowed_as_reading_list) {
      lines.push("אין להציג רשימת קריאה או המלצות מקורות בשאלה זו.");
    }
    lines.push("אין להציג מקור משני, ספרות או חומר מוסדי כפסיקה מחייבת.");
    // academic_utilization_stabilization_v1 — block-level source coverage.
    if (p.user_task_intent === "academic_writing") {
      lines.push(
        "בכתיבה אקדמית: כל פסקה מהותית (טיעון, רקע דוקטרינרי, סקירת ספרות, ביקורת) צריכה לשאת source_refs אם קיים במאגר מקור מתאים לאותו תוכן — אל תשאיר פסקאות מהותיות ללא הפניה כאשר יש מקור רלוונטי.",
      );
      lines.push(
        "העדף ספרות אקדמית ומחקר משפטי לפסקאות תיאורטיות, מושגיות וביקורתיות; שמור מקורות ראשוניים (פסיקה וחקיקה) לקביעות על הדין המחייב.",
      );
      lines.push(
        "מקור שאותר ביבליוגרפית בלבד (ללא טקסט מלא) יכול להופיע בפסקת ספרות או מסגור כהפניה לקריאה נוספת בלבד — לעולם לא כביסוס לקביעה מהותית.",
      );
    }
    lines.push(
      "אין לכתוב בתוך הטקסט מזהי מקור פנימיים (s1, s2 וכדומה) — ההפניה היחידה למשתמש היא הערת שוליים שנוצרת דטרמיניסטית מ-source_refs.",
    );

  }

  const leadSource = leadRef ? sources.find((s) => s.ref === leadRef) : undefined;
  const secondary = leadSource ? sources.filter((s) => s.ref !== leadRef) : sources;

  lines.push("");
  lines.push(`מקורות זמינים (${sources.length}) — השתמש אך ורק במזהים האלה ב-source_refs:`);

  const renderSource = (s: DrafterInputSource, opts?: { noText?: boolean }) => {
    lines.push("---");
    lines.push(`ref: ${s.ref}`);
    lines.push(`title: ${s.title}`);
    if (s.url) lines.push(`url: ${s.url}`);
    lines.push(`source_type: ${s.source_type} | role: ${s.role} | support: ${s.best_support}`);
    if (synthesisRendering?.applied) {
      lines.push(
        `authority: citable_as=${s.citable_as ?? "unknown"} | tier=${s.authority_tier ?? "unknown"} | text_usability=${s.text_usability ?? "unknown"} | has_holding_text=${s.has_holding_text === true} | synthesis_role=${s.synthesis_role ?? "unknown"}`,
      );
    }
    if (opts?.noText) {
      lines.push(
        "note: לא נמצא בו טקסט אופרטיבי מספיק; אין לגזור ממנו הלכה, יישום או סייג.",
      );
      return;
    }
    if (s.best_support === "partial") {
      lines.push(`hint: תמיכה חלקית בלבד — נסח טענה זו בלשון זהירה (ראה חוזה הראיות במערכת ההנחיות).`);
    }

    if (s.supported_points.length) {
      lines.push(`supported_points:`);
      for (const p of s.supported_points) lines.push(`  • ${p}`);
    }
    if (s.snippet) lines.push(`snippet: ${s.snippet}`);
  };

  if (synthesisRendering?.applied) {
    // Deterministic pack separation: the model never sees a non-usable judgment
    // inside the authority list.
    const g = synthesisRendering.groups;
    const byRef = new Map(sources.map((s) => [s.ref, s]));
    const section = (
      header: string,
      refs: string[],
      opts?: { noText?: boolean },
    ) => {
      lines.push("");
      lines.push(`${header} (${refs.length}):`);
      if (refs.length === 0) {
        lines.push("  (אין)");
        return;
      }
      for (const r of refs) {
        const s = byRef.get(r);
        if (s) renderSource(s, opts);
      }
    };
    if (leadSource && g.usable_authorities.includes(leadSource.ref)) {
      lines.push(`lead_ref: ${leadSource.ref}`);
    }
    section("A. סמכויות שמישות לגזירת הלכה (רק מהן מותר 'נקבע/נפסק/הוחל/הוגבל')", g.usable_authorities);
    section("B. רקע חקיקתי (חוק/תקנות — לא הלכה פסוקה)", g.statutory_background);
    section("C. הקשר משני (ספרות/פרשנות — הסבר בלבד)", g.secondary_context);
    section(
      'D. נמצאו אך אינם שמישים לגזירת הלכה (מותר להזכיר רק תחת "מה לא ניתן לקבוע מהמקורות")',
      g.found_but_not_usable,
      { noText: true },
    );
  } else if (leadSource) {
    lines.push(`lead_ref: ${leadSource.ref}`);
    renderSource(leadSource);
    if (secondary.length > 0) {
      lines.push("");
      lines.push(`secondary_refs (${secondary.length}):`);
      for (const s of secondary) renderSource(s);
    }
  } else {
    for (const s of sources) renderSource(s);
  }

  if (!useAsSource && userDocs.some((d) => d.chunks.length > 0)) {
    lines.push("");
    lines.push("הקשר רך מהמסמכים שצירף המשתמש (לרקע בלבד — אסור לצטט מהם):");
    for (const d of userDocs) {
      for (const ch of d.chunks) {
        lines.push("---");
        lines.push(`קובץ: ${d.file_name} | עמ' ${ch.page}`);
        lines.push(ch.text.slice(0, 1500));
      }
    }
  }
  lines.push("");
  lines.push(
    "תיוג בלוקים (חובה בכל פסקה/פריט רשימה): הוסף claim_id (מזהה הטענה שהבלוק מבסס, מתוך רשימת הטענות), " +
      "facet_id אם הבלוק עוסק בהיבט דוקטרינרי ספציפי, ו-proposition_type אחד מתוך " +
      "black_letter_rule (קביעת הלכה/דין), application (יישום/נסיבות), background (רקע), " +
      "practical_guidance (הנחיה מעשית), limitation (סייג/מגבלה). " +
      "צרף ל-source_refs רק מקורות שאומתו לאותה טענה — ספרות ומקורות רקע אינם אסמכתה לקביעת הלכה.",
  );

  lines.push(
    "תיוג מהות הטענה (claim_category, חובה בכל פסקה/פריט): סווג לפי מהות הקביעה ולא לפי ניסוחה — " +
      "court_holding (ייחוס הלכה, מבחן, תוצאה או כלל משפטי לבית משפט או לפסיקה), " +
      "statutory (קביעה על נוסח חוק/תקנה, תנאי, מבנה או תוצאה נורמטיבית הנובעת מהם), " +
      "doctrinal_synthesis (הסבר דוקטרינרי, מסגרת ניתוח, סיווג מקובל או סינתזה בין מקורות), " +
      "scholarly_commentary (מה גורסת הספרות, ביקורת אקדמית, מחלוקת בכתיבה), " +
      "contextual_background (רקע והקשר שאינם קובעים כלל משפטי מחייב). " +
      "רמת הניסוח חייבת להתאים לרמת הסמכות של המקור: קביעה הנשענת רק על ספרות, פרשנות או חומר מוסדי " +
      "לא תוצג כהלכה מחייבת, ככלל פסיקתי מוגמר או כתוצאה של פסק דין מסוים.",
  );

  lines.push(
    "החזר אובייקט {blocks: [...]} דרך הכלי emit_structured_draft. זכור: אסור סימני הערות שוליים בתוך text — הקוד מוסיף אותם דטרמיניסטית לפי source_refs.",
  );
  return lines.join("\n");
}

export interface LeadRefSelection {
  ref: string | null;
  reason: string;
  shape: string;
}

function selectLeadRef(
  answerIntent: AnswerIntent | undefined,
  sources: DrafterInputSource[],
  requiredAnchorCandidateIds: Set<string>,
  hasMissingDocketAnchor: boolean,
  hasMissingStatuteSectionAnchor: boolean,
): LeadRefSelection {
  const shape = answerIntent?.output_shape ?? "unknown";
  if (hasMissingDocketAnchor) {
    return { ref: null, reason: "skipped_missing_docket_anchor", shape };
  }
  if (hasMissingStatuteSectionAnchor && (shape === "definition" || shape === "quote")) {
    return { ref: null, reason: "skipped_missing_statute_section_anchor", shape };
  }
  if (shape !== "case_holding" && shape !== "definition" && shape !== "quote") {
    return { ref: null, reason: "shape_not_eligible", shape };
  }
  const scoreOf = (s: DrafterInputSource): number => {
    let n = 0;
    if (requiredAnchorCandidateIds.has(s.candidate_id)) n += 100;
    // Authority tier: official/recognized primary outranks a statute mirror,
    // which outranks commentary. Listing pages are already filtered out.
    n += tierRank((s.authority_tier ?? "unknown") as AuthorityTier) * 4;
    if (s.text_usability === "full_text") n += 3;
    else if (s.text_usability === "substantive_excerpt") n += 1;
    if (s.best_support === "direct") n += 10;
    n += Math.min((s.snippet?.length ?? 0) / 100, 5);
    return n;
  };

  const pick = (pool: DrafterInputSource[]): DrafterInputSource | null =>
    pool.length ? [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))[0] : null;

  // source_type strings from candidates include: caselaw, supreme_court_il,
  // israeli_law, other, journal_article, ... Roles are useful but not always
  // reliable — the planner sometimes stamps `primary_statute` on any candidate
  // returned to a primary_statute query, including journal articles. We
  // therefore use source_type as a VETO: a scholarship / journal / news /
  // user_document source can never be a lead for definition / case_holding /
  // quote shapes, even if the role tag says otherwise.
  const isCaseType = (t: string) =>
    t === "caselaw" || t === "supreme_court_il" || t === "case";
  const isStatuteType = (t: string) =>
    t === "israeli_law" || t === "statute" || t === "regulation" || t === "legislation";
  // Source-type veto: types that are definitively NOT primary/official law
  // and must never be selected as a lead for the eligible shapes.
  const isNonOfficialType = (t: string) =>
    t === "journal_article" ||
    t === "article" ||
    t === "scholarship" ||
    t === "news" ||
    t === "blog" ||
    t === "user_document";
  // Source-integrity veto: listing/pagination/non-authority pages can never
  // lead an answer, regardless of the source_type they were tagged with.
  const citable = sources.filter(
    (s) => s.citable_as !== "not_citable" && s.authority_tier !== "index_or_listing",
  );
  const officialOnly = citable.filter((s) => !isNonOfficialType(s.source_type));

  if (shape === "case_holding") {
    const cases = officialOnly.filter(
      (s) =>
        // Must be usable judgment text — an index/metadata-only page cannot
        // satisfy a holding lead.
        (s.citable_as === "judgment" || s.citable_as === undefined) &&
        s.text_usability !== "metadata_only" &&
        s.text_usability !== "listing_page" &&
        (isCaseType(s.source_type) ||
          // Role fallback ONLY when source_type is neutral ("other"), never for
          // clearly-statutory types.
          ((s.role === "binding_case_law" || s.role === "persuasive_case_law") &&
            s.source_type === "other")),
    );


    if (cases.length === 0) return { ref: null, reason: "no_case_source", shape };
    const req = cases.filter((s) => requiredAnchorCandidateIds.has(s.candidate_id));
    if (req.length > 0) {
      const chosen = pick(req)!;
      return { ref: chosen.ref, reason: "required_anchor_case", shape };
    }
    const binding = cases.filter((s) => s.role === "binding_case_law");
    const pool = binding.length ? binding : cases;
    const chosen = pick(pool);
    if (!chosen) return { ref: null, reason: "no_eligible_case", shape };
    return {
      ref: chosen.ref,
      reason: binding.length ? "binding_case_law" : "best_case",
      shape,
    };
  }

  if (shape === "definition") {
    const primary = officialOnly.filter(
      (s) =>
        isStatuteType(s.source_type) ||
        // Role fallback ONLY when source_type is neutral ("other"). Prevents
        // journal articles / caselaw tagged primary_statute from leading a
        // definition answer.
        ((s.role === "primary_statute" || s.role === "regulation") &&
          s.source_type === "other"),
    );
    if (primary.length === 0) return { ref: null, reason: "no_statute_source", shape };
    const req = primary.filter((s) => requiredAnchorCandidateIds.has(s.candidate_id));
    if (req.length > 0) {
      return { ref: pick(req)!.ref, reason: "required_anchor_statute", shape };
    }
    // Prefer sources whose source_type is explicitly statutory over the
    // role-only fallback ("other" with primary_statute role).
    const strong = primary.filter((s) => isStatuteType(s.source_type));
    const pool = strong.length ? strong : primary;
    const chosen = pick(pool);
    if (!chosen) return { ref: null, reason: "no_eligible_statute", shape };
    return {
      ref: chosen.ref,
      reason: strong.length ? "primary_statute" : "primary_statute_role_fallback",
      shape,
    };
  }

  // quote — official/primary source that actually carries a snippet.
  const primary = officialOnly.filter(
    (s) =>
      isStatuteType(s.source_type) ||
      isCaseType(s.source_type) ||
      ((s.role === "primary_statute" ||
        s.role === "regulation" ||
        s.role === "binding_case_law") &&
        s.source_type === "other"),
  );
  const withSnippet = primary.filter((s) => (s.snippet ?? "").length >= 50);
  if (withSnippet.length === 0) return { ref: null, reason: "no_official_snippet", shape };
  const req = withSnippet.filter((s) => requiredAnchorCandidateIds.has(s.candidate_id));
  const chosen = req.length ? pick(req)! : pick(withSnippet)!;
  return {
    ref: chosen.ref,
    reason: req.length ? "required_anchor_official" : "official_source_with_snippet",
    shape,
  };
}

export interface QualityWarningHit {
  bucket: string;
  match: string;
  index: number;
}

function buildStatuteSectionLimitationDraft(
  missingAnchors: Array<{ description: string; is_docket?: boolean; is_statute_section?: boolean }>,
  citationRefs: string[],
): StructuredDraft {
  const descriptions = missingAnchors
    .filter((a) => a.is_statute_section)
    .map((a) => a.description)
    .filter((x) => x.trim().length > 0);
  const target = descriptions.length > 0 ? descriptions.join("; ") : "הסעיף המבוקש";
  const source_refs = citationRefs.slice(0, 1);

  return {
    blocks: [
      {
        kind: "paragraph",
        text: `לא אותר במקורות שעברו אימות נוסח מוסמך ומלא של ${target}; לכן לא ניתן להביא כאן הגדרה מחייבת, ציטוט מחייב או רשימת תנאים מצטברים מתוך הסעיף. אין לשחזר את ההגדרה ממקורות משניים, ממסמכים סמוכים, מהצעות חוק או מסעיפים אחרים.`,
        source_refs,
      },
    ],
  };
}

function buildDocketLimitationDraft(
  missingAnchors: Array<{ description: string; is_docket?: boolean; is_statute_section?: boolean }>,
): StructuredDraft {
  const descriptions = missingAnchors
    .filter((a) => a.is_docket)
    .map((a) => a.description)
    .filter((x) => x.trim().length > 0);
  const target = descriptions.length > 0 ? descriptions.join("; ") : "פסק הדין המבוקש";

  return {
    blocks: [
      {
        kind: "paragraph",
        text: `לא אותר במקורות הזמינים ${target}. לכן לא ניתן לקבוע באופן מוסמך מה נקבע בו, מה היו הנימוקים או מה הייתה תוצאת ההליך. אין להשיב מתיקים דומים, ממקורות רקע או מספרות משנית.`,
        source_refs: [],
      },
      {
        kind: "paragraph",
        text: `אם יש לך את פסק הדין בקובץ PDF/DOCX או צילום, אפשר להעלות אותו כאן, ואנתח מתוכו את ההחזקה, הנימוקים המרכזיים, העובדות הרלוונטיות והמשמעות המשפטית.`,
        source_refs: [],
      },
    ],
  };
}

/**
 * Deterministic limited-source answer for questions whose source pack does not
 * contain authority about the asked topic. Never derives a legal rule; may
 * mention, factually, what kind of material was found.
 */
function buildInsufficientSourcesDraft(s: SufficiencyAssessment): StructuredDraft {
  const opening = s.category === "practical_list"
    ? "לא נמצאו במקורות מקורות משפטיים ייעודיים לנושא שנשאל, אלא חומר כללי בלבד. ניתן להעלות מקור/לחדד שאלה/לבקש חיפוש נוסף."
    : "לא נמצאה במקורות פסיקה ישירה על הנושא. ניתן להעלות מקור/לחדד שאלה/לבקש חיפוש נוסף.";
  const blocks: StructuredDraft["blocks"] = [
    { kind: "paragraph", text: opening, source_refs: [] },
    {
      kind: "paragraph",
      text: s.category === "practical_list"
        ? "אין לגזור צעדים משפטיים קונקרטיים לנושא שנשאל ממקורות מתחום אחר או מחומר פרוצדורלי כללי; לכן לא מוצגת כאן הנחיה משפטית לשאלה שנשאלה."
        : "אין לגזור את הדוקטרינה שנשאלה ממקורות מתחום משפטי אחר בדרך של היקש; לכן לא מוצגת כאן קביעה משפטית לגבי השאלה שנשאלה.",
      source_refs: [],
    },
  ];
  if (s.found_titles.length > 0) {
    blocks.push({
      kind: "paragraph",
      text: `מה כן נמצא במקורות (לידיעה בלבד, ללא גזירת כללים לשאלה שנשאלה): ${
        s.found_titles.slice(0, 4).join("; ")
      }.`,
      source_refs: [],
    });
  }
  return { blocks };
}



/**
 * Deterministic verbatim-quote draft for statute-section anchors whose
 * canonical text is registered in {@link getStatuteSectionCanonicalText}.
 * Bypasses the LLM entirely so the model can never paraphrase or distort
 * statutory wording. When canonical text is unavailable, callers must fall
 * back to {@link buildStatuteSectionLimitationDraft} instead of asking the
 * model to reproduce the quote.
 */
function buildStatuteSectionCanonicalQuoteDraft(args: {
  canonicalText: string;
  description: string;
  sourceRef: string;
}): StructuredDraft {
  const { canonicalText, description, sourceRef } = args;
  return {
    blocks: [
      {
        kind: "paragraph",
        text: `${description} (נוסח מילולי): "${canonicalText}"`,
        source_refs: [sourceRef],
      },
      {
        kind: "paragraph",
        text: "הציטוט מובא כלשונו מהמקור הרשמי המצוין למעלה; לא בוצע שינוי, תמצות או ניסוח מחדש.",
        source_refs: [sourceRef],
      },
    ],
  };
}

function buildCanonicalRegistrySource(ref: StatuteSectionRef): DrafterInputSource | null {
  const canonical = getStatuteSectionCanonicalEntry(ref);
  if (!canonical) return null;
  return {
    ref: `r_${ref.ref_id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`,
    candidate_id: `canonical:${ref.ref_id}`,
    title: canonical.official_source_title,
    raw_title: canonical.official_source_title,
    title_status: "ok",
    title_hygiene_reasons: [],
    url: canonical.official_source_url,
    source_type: "israeli_law",
    role: "primary_statute",
    origin: "local_db",
    best_support: "direct",
    supported_points: [canonical.text],
    claim_ids: [],
    snippet: canonical.text,
  };
}

export interface QualityWarning {
  buckets: string[];
  hit_count: number;
  hits: QualityWarningHit[];
}

const BROKEN_HEBREW_DENYLIST = [
  "בשן טוב",
  "לא להתאזר בסבירות",
  "הודו-נתונה סמכות חוקית",
  "תקנן הסביר",
  "הגנה ההופכת",
  "הכלתנייתיות",
  "אפסון נזיקין",
  "סעדין ניתנים",
  "כברות של נאשם אחר",
  // V2.1e additions — invented words / malformed compounds / unnatural phrasing.
  "סמלייים",
  "סמליומית",
  "הבטחה מנהירת סמכויות",
  "המשרוק",
  "מום פרשני",
  "שווה לנקוט",
  "משקל תקף נמוך יותר",
  // Phase B additions — observed bad phrases.
  "פוקודה",
  "המסקנהיות",
  "כלים עיליים",
  "הדין הפרשני האקטיבי",
  "כלי עובדני",
];

// V2.1e — wrong official names. Canonical: "חוק-יסוד: כבוד האדם וחירותו".
const WRONG_OFFICIAL_NAME_PHRASES = [
  "כיבוד האדם והחירות",
  "חוק-יסוד של כיבוד האדם והחירות",
];

// V2.1e — foreign words appearing inside Hebrew legal answers. Tight allowlist —
// not a generic Latin sweep (URLs/refs contain Latin). Case-insensitive.
const FOREIGN_WORD_PATTERNS: RegExp[] = [
  /\balcance\b/gi,
];

// Truncated source-label fragments: דו / הדו / והדו / הספרות והדו followed by . or "
// and then a non-Hebrew-letter (whitespace, punctuation, end). Hebrew letters U+05D0–U+05EA.
const TRUNCATED_FRAGMENT_RE =
  /(?<![\u05D0-\u05EA])((?:הספרות\s+)?ו?ה?דו)["\.](?![\u05D0-\u05EA])/g;

// Scaffold leakage. Avoid broad s\d+ — too noisy.
const SCAFFOLD_PATTERNS: Array<{ bucket: string; re: RegExp }> = [
  { bucket: "scaffold_leakage", re: /שאלה\s+C\d+/g },
  { bucket: "scaffold_leakage", re: /\bC\d+\b/g },
  { bucket: "scaffold_leakage", re: /\bclaim_id\b/g },
  { bucket: "scaffold_leakage", re: /\bcandidate_id\b/g },
  { bucket: "scaffold_leakage", re: /\bu\d+p\d+\b/g },
];

// V2.1e — civil/tort vs criminal context markers for wrong-party-label check.
const CIVIL_MARKERS = [
  "נזיקין", "רשלנות", "תביעה אזרחית", "פיצויים", "תובע", "נתבע",
  "חוזה", "חוזים", "הפרת חוזה", "עוולה",
];
const CRIMINAL_MARKERS = [
  "פלילי", "פליליים", "כתב אישום", "הרשעה", "גזר דין",
  "עונש", "מאסר", "קנס פלילי", "המאשימה",
];
const NAASHAM_RE = /(?<![\u05D0-\u05EA])ה?נאשם(?:ים|ת|ות)?(?![\u05D0-\u05EA])/g;

function computeQualityWarning(
  answer: string,
  context?: { question?: string; source_context?: string },
): QualityWarning | undefined {
  if (!answer) return undefined;
  const hits: QualityWarningHit[] = [];

  for (const phrase of BROKEN_HEBREW_DENYLIST) {
    let idx = answer.indexOf(phrase);
    while (idx !== -1) {
      hits.push({ bucket: "broken_hebrew", match: phrase, index: idx });
      idx = answer.indexOf(phrase, idx + phrase.length);
    }
  }

  for (const phrase of WRONG_OFFICIAL_NAME_PHRASES) {
    let idx = answer.indexOf(phrase);
    while (idx !== -1) {
      hits.push({ bucket: "wrong_official_name", match: phrase, index: idx });
      idx = answer.indexOf(phrase, idx + phrase.length);
    }
  }

  for (const re of FOREIGN_WORD_PATTERNS) {
    for (const m of answer.matchAll(re)) {
      hits.push({ bucket: "foreign_word_in_hebrew", match: m[0], index: m.index ?? -1 });
    }
  }

  for (const m of answer.matchAll(TRUNCATED_FRAGMENT_RE)) {
    hits.push({
      bucket: "truncated_source_fragment",
      match: m[0],
      index: m.index ?? -1,
    });
  }

  for (const { bucket, re } of SCAFFOLD_PATTERNS) {
    for (const m of answer.matchAll(re)) {
      hits.push({ bucket, match: m[0], index: m.index ?? -1 });
    }
  }

  // V2.1e — wrong party label in civil/tort context.
  const ctxBlob = `${context?.question ?? ""}\n${context?.source_context ?? ""}`;
  if (ctxBlob.trim()) {
    const hasCivil = CIVIL_MARKERS.some((m) => ctxBlob.includes(m));
    const hasCriminal = CRIMINAL_MARKERS.some((m) => ctxBlob.includes(m));
    if (hasCivil && !hasCriminal) {
      for (const m of answer.matchAll(NAASHAM_RE)) {
        hits.push({
          bucket: "wrong_party_label_civil",
          match: m[0],
          index: m.index ?? -1,
        });
      }
    }
  }

  if (hits.length === 0) return undefined;
  const buckets = Array.from(new Set(hits.map((h) => h.bucket))).sort();
  return { buckets, hit_count: hits.length, hits: hits.slice(0, 50) };
}

export interface DrafterV2Result {
  /** non_academic_source_binding_and_csm_v1 */
  non_academic_limitation_note?: NonAcademicLimitationNote;
  ok: boolean;
  ms: number;
  model_initial: string;
  model_final: string;
  provider: "openai" | "anthropic";
  escalated: boolean;
  sources_passed: number;
  sources_used: number;
  answer_markdown: string;
  used_sources: UsedSource[];
  footnotes: Footnote[];
  stage_runs: StageRun[];
  error?: string;
  raw_text?: string;
  structured_validation: StructuredValidation;
  /** Parsed structured draft (used by the answer-style report-only gate). */
  structured_draft?: import("./structuredValidation.ts").StructuredDraft | null;
  /** Input sources actually passed to the drafter (display titles applied). */
  input_sources?: DrafterInputSource[];
  builder_report?: ReturnType<typeof buildFootnotedAnswer>["builder_report"];
  hierarchy_report?: ReturnType<typeof buildFootnotedAnswer>["hierarchy_report"];
  footnote_render_report?: ReturnType<typeof buildFootnotedAnswer>["footnote_render_report"];
  /** footnote_density_v1 — per-block per-occurrence emission telemetry. */
  footnote_density_emission?: ReturnType<typeof buildFootnotedAnswer>["footnote_density_emission"];
  footnote_materialization?: ReturnType<typeof buildFootnotedAnswer>["footnote_materialization"];
  footnote_builder_richness_summary?: ReturnType<
    typeof buildFootnotedAnswer
  >["footnote_builder_richness_summary"];
  quality_warning?: QualityWarning;
  usage?: { input_tokens?: number; output_tokens?: number };
  // Debug: whether the missing-required-anchor caveat instruction was injected.
  missing_anchor_caveat_injected?: boolean;
  /** Lead-source selection telemetry (Phase-1 lead_ref patch). */
  lead_ref?: LeadRefSelection;
  missing_anchor_descriptions?: string[];
  /**
   * Deterministic drafter branch that fired (bypassing the LLM), if any.
   * One of: "docket_limitation", "statute_section_limitation",
   * "canonical_quote_registry", "canonical_quote_verified",
   * "statute_section_quote_refusal". Unset when the LLM drafter ran.
   */
  deterministic_branch?:
    | "docket_limitation"
    | "statute_section_limitation"
    | "canonical_quote_registry"
    | "canonical_quote_verified"
    | "statute_section_quote_refusal"
    | "insufficient_sources_limitation"
    | "academic_limited_draft";
  /** academic_draft_presentation_hygiene_v1 telemetry. */
  academic_presentation_hygiene?: AcademicHygieneReport;
  academic_style_model?: AcademicStyleModelReport & { answer_words?: number };
  /** academic_drafter_prompt_conflict_cleanup_v1 telemetry. */
  academic_prompt_cleanup?: AcademicPromptCleanupReport & {
    rhythm_rules_as_ceilings: boolean;
    hygiene_softened: boolean;
    paragraph_trimmed: boolean;
    bullets_converted_or_preserved: string;
    drift_paragraphs_dropped: number;
  };
  /** academic_drafter_source_ref_coverage_v2 telemetry. */
  academic_drafter_source_ref_emission?: AcademicDrafterSourceRefEmission;
  pre_csm_source_ref_filtering?: PreCsmSourceRefFiltering;



  /** Deterministic source-sufficiency assessment (telemetry + gate result). */

  /** claim_source_match_validation_v1 — per-block claim/source gate telemetry. */
  claim_source_match?: ClaimSourceMatchReport;
  /** substance_based_doctrinal_sufficiency_v1 telemetry. */
  doctrinal_typing?: DoctrinalTypingReport;

  sufficiency?: SufficiencyAssessment;
  /** Named-doctrine premise/framing signal (telemetry + drafter directive). */
  named_doctrine_framing?: NamedDoctrineFraming;
  /** Synthesis snippet-budget telemetry (case-law synthesis runs only). */
  snippet_budget_report?: SnippetBudgetReport;
  /** Case-law synthesis rendering telemetry (synthesis runs only). */
  synthesis_rendering?: SynthesisRenderingReport;
  /** metadata_only_holding_gate_v1 telemetry (model-drafted answers only). */
  metadata_only_holding_gate?: MetadataOnlyHoldingGateReport;
  /** router_profiles_v1 — block-ceiling trim telemetry. */
  router_block_trim?: BlockTrimReport;
  /** topic_aware_source_role_and_claim_alignment_v1 telemetry. */
  topic_aware_alignment?: TopicAwareAlignmentReport;
  limitation_note_alignment?: LimitationNoteAlignment;
  /** topic_aware_claim_source_alignment_v1 — pre/post draft plan telemetry. */
  claim_source_plan?: ClaimSourcePlan;
  /** canonical_registry_discovery_and_representative_source_use_v1 telemetry. */
  representative_source_selection?: RepresentativeSourceReport;
  representative_source_use?: { rows: unknown[]; used: number; omitted: number };
  drafter_representative_source_compliance?: {
    version: string;
    rows: unknown[];
    claims_checked: number;
    claims_compliant: number;
  };
  statute_dominance_check?: StatuteDominanceCheck;
  source_last_mile_funnel?: SourceLastMileFunnelReport;
  drafter_block_source_compliance?: DrafterBlockComplianceReport;
  post_draft_alignment_filter?: PostDraftAlignmentFilterReport;






  schema_failure_reason?:
    | "no_tool_call"
    | "json_parse"
    | "schema_invalid"
    | "no_cited_segments"
    | "unknown_source_refs"
    | "forbidden_markers_in_text"
    | "no_usable_candidates";
  // ── Truncation guard telemetry (drafterV2-only, additive) ─────────────
  /** Completeness report on the final draft that was rendered. */
  completeness?: CompletenessReport;
  /** Completeness report on the very first draft (before any retry). */
  completeness_initial?: CompletenessReport;
  /** Retry accounting for the truncation guard. */
  truncation_retry?: {
    attempted: boolean;
    same_model_retry: boolean;
    escalated_to_full: boolean;
    retry_ms: number;
    reasons_initial: string[];
  };
  /** `max_completion_tokens` value on the final successful call. */
  max_completion_tokens_used?: number;
}

export async function runDrafterV2(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
  verifier: { usable: UsableCandidate[]; verdicts: Verdict[] },
  opts?: {
    userDocs?: UserDocument[];
    useAsSource?: boolean;
    // Harness-only: force a specific drafter model (e.g. MODEL_FULL) and
    // skip the mini→full escalation. Used by offline model-comparison runs.
    forceModel?: string;
    skipEscalation?: boolean;
    // Harness-only: provider routing. Defaults to "openai" (Lovable AI Gateway).
    // "anthropic" calls the Anthropic Messages API directly with the same
    // structured-output schema; the rest of the pipeline is identical.
    provider?: "openai" | "anthropic";
    // Required-anchor caveat (Phase-1 minimal): when one or more declared
    // legal anchors did not reach the verifier or were not effectively
    // supported, append a single instruction to the user message telling
    // the drafter to caveat the answer instead of inferring around them.
    missingRequiredAnchors?: Array<{
      anchor_id?: string;
      description: string;
      is_docket?: boolean;
      is_statute_section?: boolean;
    }>;
    // Optional analyzer-emitted answer intent. Rendered into the user message
    // as a compact "Answer Intent" block; the drafter system prompt has
    // per-shape and per-posture rules that reference it. Backwards
    // compatible: omit → drafter falls back to prior behavior.
    answerIntent?: AnswerIntent;
    // Narrow lead-source signal: candidate_ids that satisfy a required anchor
    // (docket or non-docket). Used deterministically to select `lead_ref` for
    // case_holding / definition / quote shapes only. Backwards compatible.
    requiredAnchorCandidateIds?: Set<string>;
    // Satisfied statute-section anchors (verified_support === "direct").
    // Used by the deterministic quote path: when shape === "quote" and a
    // registered canonical text exists for the anchor, the drafter bypasses
    // the LLM and emits the exact statutory wording. When no canonical text
    // is registered, the drafter refuses instead of paraphrasing.
    satisfiedStatuteSectionAnchors?: Array<{
      description: string;
      ref: StatuteSectionRef;
      candidate_ids: string[];
    }>;
    /** Planner research mode — gates the synthesis snippet budget only. */
    researchMode?: string | null;
    /**
     * Specific-case authority gate (specific_case mode only). When `allow` is
     * false, the drafter fires `docket_limitation` deterministically — no
     * substantive holding may be drafted from near-name commentary, listing
     * pages, or adjacent cases, regardless of how large the source pack is.
     */
    /**
     * claim_facet_expansion_v1 — facet-scoped directive lines appended to the
     * drafter user message (doctrine/analysis runs only). Purely additive.
     */
    facetDirective?: string[];
    /**
     * router_profiles_v1 — max structured blocks for the selected path.
     * Enforced twice: as a prompt instruction, and deterministically on the
     * parsed draft before any gate or footnote building runs.
     */
    blockCeiling?: number | null;
    dropUnsupportedBlocks?: boolean;
    /** five_mode_source_depth_policy_v1 depth mode (doctrinal sufficiency fallback). */
    depthMode?: string | null;
    /** source_use_intent_planning_v1 — planned task / source-use contract. */
    sourceUsePlan?: SourceUsePlan | null;

    specificCaseGate?: {
      allow: boolean;
      docket_display: string | null;
      reason: string;
    } | null;
  },
): Promise<DrafterV2Result> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];

  const userDocs = opts?.userDocs ?? [];
  const useAsSource = opts?.useAsSource ?? false;
  const forceModel = opts?.forceModel;
  const skipEscalation = opts?.skipEscalation === true || !!forceModel;
  const provider: "openai" | "anthropic" = opts?.provider ?? "openai";


  const inputSources = buildInputSources(
    candidates,
    verifier.verdicts,
    verifier.usable,
    userDocs,
    useAsSource,
    opts?.researchMode ?? null,
  );
  // substance_based_doctrinal_sufficiency_v1 — re-type acquired `other`
  // sources that are genuinely doctrinal material, then report eligibility.
  const doctrinal_typing: DoctrinalTypingReport = buildDoctrinalTypingReport(
    inputSources,
    remapDoctrinalSourceTypes(inputSources),
  );

  const snippet_budget_report = summarizeSnippetBudget(
    opts?.researchMode ?? null,
    inputSources.map((s) => ({
      ref: s.ref,
      citable_as: String(s.citable_as ?? "unknown"),
      synthesis_role: String(s.synthesis_role ?? "unknown"),
      text_usability: String(s.text_usability ?? "unknown"),
      budget: s.snippet_budget ?? 500,
      expanded: s.snippet_budget_expanded ?? false,
      reason: (s.snippet_budget_reason ?? "not_synthesis_mode") as never,
      snippet_length: s.snippet_length ?? (s.snippet?.length ?? 0),
      available_text_length: s.available_text_length ?? (s.snippet?.length ?? 0),
      has_holding_text: s.has_holding_text ?? false,
      has_statutory_text: s.has_statutory_text ?? false,
    })),
  );
  const shape = opts?.answerIntent?.output_shape;
  const canonicalQuoteRefs = shape === "quote"
    ? detectStatuteSections(question).filter((ref) => getStatuteSectionCanonicalEntry(ref))
    : [];
  for (const ref of canonicalQuoteRefs) {
    const registrySource = buildCanonicalRegistrySource(ref);
    if (registrySource && !inputSources.some((s) => s.candidate_id === registrySource.candidate_id)) {
      inputSources.unshift(registrySource);
    }
  }
  // academic_declared_category_remap_and_body_acquisition_v2 — pack-level
  // subject-matter fit for academic drafts: drop sources with no shared
  // subject vocabulary before they reach the prompt (conservative — never
  // primary authority, never below a 3-source floor).
  let academic_pack_fit_dropped: Array<{ ref: string; title: string; score: number }> = [];
  const academicWritingRun = opts?.sourceUsePlan?.user_task_intent === "academic_writing";
  // natural_literature_mode_and_topic_guard_v1 — natural Hebrew literature
  // prompts activate the same machinery as the narrow lab phrasing.
  const literatureOnlyRun = opts?.literatureMode === true ||
    (academicWritingRun && isLiteratureOnlyRequest(question));

  // academic_literature_richness_without_fixed_source_count_v1 — dynamic pack
  // selection: relevance and role coverage decide membership, never a count.
  let academic_pack_selection: PackSelectionDecision[] = [];
  if (literatureOnlyRun) {
    const sel = selectLiteraturePack(
      question,
      inputSources.map((s) => ({
        ref: s.ref,
        candidate_id: s.candidate_id,
        title: String(s.title ?? ""),
        url: s.url,
        snippet: s.snippet,
        role: s.role ? String(s.role) : null,
        source_type: s.source_type ? String(s.source_type) : null,
        citable_as: s.citable_as ? String(s.citable_as) : null,
        body_available: s.body_acquired === true,
        primary: String(s.citable_as ?? "") === "judgment" ||
          String(s.citable_as ?? "") === "statute",
      })),
      { literature_mode: true },
    );
    academic_pack_selection = sel.decisions;
    const keep = new Set(sel.kept.map((k) => k.ref));
    // Never empty the pack: if selection would remove everything, keep it as-is.
    if (keep.size > 0) {
      for (let i = inputSources.length - 1; i >= 0; i--) {
        if (!keep.has(inputSources[i].ref)) inputSources.splice(i, 1);
      }
    }
  } else if (academicWritingRun) {
    const fit = academicPackFit(question, inputSources);
    if (fit.dropped.length > 0) {
      academic_pack_fit_dropped = fit.dropped;
      const keep = new Set(fit.kept.map((s) => s.ref));
      for (let i = inputSources.length - 1; i >= 0; i--) {
        if (!keep.has(inputSources[i].ref)) inputSources.splice(i, 1);
      }
    }
  }
  // Research-richness sufficiency, evaluated BEFORE drafting.
  let academic_richness_sufficiency: RichnessAssessment | null = null;
  if (academicWritingRun) {
    const scored = inputSources.map((s) => ({
      s,
      t: scoreLiteratureTopicality(question, {
        title: s.title,
        snippet: s.snippet,
        url: s.url,
      }),
    }));
    const roles = new Set(
      scored.filter((x) => x.t.shared_count > 0).map((x) => String(x.s.synthesis_role ?? x.s.role ?? "unknown")),
    );
    academic_richness_sufficiency = assessResearchRichness({
      run_id: "",
      task_type: literatureOnlyRun ? "literature_review" : "academic_writing",
      literature_mode: literatureOnlyRun,
      direct_literature_found: scored.filter((x) => x.t.direct).length,
      direct_literature_body_acquired:
        scored.filter((x) => x.t.direct && x.s.body_acquired === true).length,
      strong_unused_literature_count: academic_pack_selection.filter((d) =>
        d.rejected_from_pack && d.source_quality === "direct_scholarship"
      ).length,
      role_coverage: [...roles],
      pack_sources_count: inputSources.length,
      off_topic_in_pack: scored.filter((x) => x.t.shared_count === 0).length,
    });
  }
  // topic_aware_source_role_and_claim_alignment_v1 — role labels must be
  // compatible with the source type before the pack is rendered.
  const source_role_sanity: SourceRoleSanityReport = applySourceRoleSanity(inputSources);
  const sources_passed = inputSources.length;

  const allowedRefs = new Set(inputSources.map((s) => s.ref));


  const emptyValidation: StructuredValidation = {
    ok: false,
    errors: ["no_usable_candidates"],
    block_count: 0,
    paragraph_count: 0,
    list_item_count: 0,
    heading_count: 0,
    cited_segment_count: 0,
    total_source_ref_count: 0,
    unknown_source_refs: [],
    forbidden_text_hits: [],
  };

  // NOTE: the generic empty-candidate early return is intentionally deferred
  // until after the deterministic missing-docket evaluation below, so that a
  // fake/unresolved docket returns the `docket_limitation` refusal instead of
  // a stub (missing_docket_limitation_before_empty_candidate_guard_v1).


  const missingAnchors = (opts?.missingRequiredAnchors ?? []).filter((a) =>
    !canonicalQuoteRefs.some((ref) => a.anchor_id === `statute_section:${ref.ref_id}`)
  );
  const requiredAnchorCandidateIds = opts?.requiredAnchorCandidateIds ?? new Set<string>();

  // Defensive docket guard: for case_holding, if the question contains a
  // docket pattern and no case source in the input pool matches that docket,
  // treat as a missing docket anchor even when the required-anchor pipeline
  // did not register it. This prevents `best_case` fallback from citing an
  // unrelated ruling as the "leading source" when the user asked about a
  // specific case.
  const requestedDockets: DocketRef[] = shape === "case_holding"
    ? detectDockets(question)
    : [];
  const CASE_LIKE = new Set(["caselaw", "supreme_court_il", "case", "court_case"]);
  const unmatchedRequestedDockets: DocketRef[] = requestedDockets.filter((d) => {
    // Already surfaced as a missing required anchor — leave existing handling.
    const anchorId = `docket:${d.docket_id}`;
    if (missingAnchors.some((a) => (a as { anchor_id?: string }).anchor_id === anchorId)) {
      return true;
    }
    // Consider matched only if a CASE-LIKE input source mentions the docket
    // in its title/snippet/url. An academic article that merely cites the
    // docket does not count — otherwise B2-style requests (Ka'adan) silently
    // fall back to `best_case` on a retrospective article.
    return !inputSources.some((s) =>
      CASE_LIKE.has(String(s.source_type ?? "").toLowerCase()) &&
      candidateMatchesDocket(
        // Title/URL only — snippet mentions of the target docket in a later
        // case's analysis do not make that later case the requested ruling.
        { title: s.title, snippet: null, url: s.url },
        [d],
      )
    );
  });

  const synthesizedDocketMissing = unmatchedRequestedDockets
    .filter((d) => !missingAnchors.some((a) => a.is_docket && a.description.includes(d.number)))
    .map((d) => ({
      anchor_id: `docket:${d.docket_id}`,
      description: `${d.prefix_he} ${d.number}`,
      is_docket: true,
      is_statute_section: false,
    }));
  if (synthesizedDocketMissing.length > 0) {
    missingAnchors.push(...synthesizedDocketMissing);
  }

  // Specific-case gate: in `specific_case` mode the exact requested docket
  // must have been resolved with usable text. Otherwise refuse, whatever the
  // analyzer's shape guess was (P02: noisy pool must not defeat the guard).
  const specificCaseGate = opts?.specificCaseGate ?? null;
  // Conversely: when the gate *did* resolve the exact docket with usable text
  // (fast lane or pool), the defensive docket guard must not re-synthesize a
  // missing anchor for that same docket — the body is in hand (R01/B2).
  if (specificCaseGate?.allow === true && specificCaseGate.docket_display) {
    const resolvedNumbers = requestedDockets.map((d) => d.number);
    const display = specificCaseGate.docket_display;
    for (let i = missingAnchors.length - 1; i >= 0; i--) {
      const a = missingAnchors[i];
      if (!a.is_docket) continue;
      const matchesResolved = a.description.includes(display) ||
        resolvedNumbers.some((n) => a.description.includes(n));
      if (matchesResolved) missingAnchors.splice(i, 1);
    }
  }

  const statuteSectionLimitationActive =
    missingAnchors.some((a) => a.is_statute_section) &&
    (shape === "definition" || shape === "quote");
  const specificCaseRefusal = !!specificCaseGate && specificCaseGate.allow === false;
  if (specificCaseRefusal && specificCaseGate?.docket_display) {
    const display = specificCaseGate.docket_display;
    if (!missingAnchors.some((a) => a.is_docket && a.description.includes(display))) {
      missingAnchors.push({
        anchor_id: `docket:${display}`,
        description: display,
        is_docket: true,
        is_statute_section: false,
      });
    }
  }
  const docketLimitationActive =
    specificCaseRefusal ||
    (missingAnchors.some((a) => a.is_docket) && shape === "case_holding");
  const leadSelection = selectLeadRef(
    opts?.answerIntent,
    inputSources,
    requiredAnchorCandidateIds,
    missingAnchors.some((a) => a.is_docket),
    missingAnchors.some((a) => a.is_statute_section),
  );

  // Deferred generic empty-candidate guard: only fires when no deterministic
  // missing-docket refusal applies.
  if (sources_passed === 0 && !docketLimitationActive) {
    return {
      snippet_budget_report,
      ok: false,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: MODEL_MINI,
      provider,
      escalated: false,
      sources_passed: 0,
      sources_used: 0,
      answer_markdown: "",
      used_sources: [],
      footnotes: [],
      stage_runs,
      error: "no_usable_candidates",
      structured_validation: emptyValidation,
      schema_failure_reason: "no_usable_candidates",
    };
  }

  if (docketLimitationActive) {
    const t0 = Date.now();
    const draft = buildDocketLimitationDraft(missingAnchors);
    const validationRaw = validateStructuredDraft(draft, allowedRefs);
    const validation = validationRaw.report.errors.every((e) => e === "no cited segments")
      ? {
          draft,
          report: {
            ...validationRaw.report,
            ok: true,
            errors: [],
          },
        }
      : validationRaw;
    const built = validation.draft
      ? buildFootnotedAnswer(validation.draft, inputSources)
      : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
    const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
    return {
      snippet_budget_report,
      ok: validation.report.ok,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: forceModel ?? MODEL_MINI,
      provider,
      escalated: false,
      sources_passed,
      sources_used: built.used_sources.length,
      answer_markdown: answer,
      used_sources: built.used_sources,
      footnotes: built.footnotes,
      stage_runs: [{
        stage: "drafter_v2_docket_guard",
        model: "deterministic",
        ms: Date.now() - t0,
        ok: validation.report.ok,
      }],
      structured_validation: validation.report,
      structured_draft: validation.draft,
      input_sources: inputSources,
      builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
      quality_warning: computeQualityWarning(answer, { question }),
      missing_anchor_caveat_injected: true,
      lead_ref: leadSelection,
      missing_anchor_descriptions: missingAnchors.map((a) => a.description),
      deterministic_branch: "docket_limitation",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String("docket_limitation")),
      schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
    };
  }

  // Deterministic canonical-quote branch. Seeded canonical statute-section
  // quotes do not depend on retrieval rediscovering the same source: if the
  // user's quote request detects a registered statute section, emit the vetted
  // text and cite the registry's official URL. Retrieval remains telemetry.
  if (shape === "quote" && canonicalQuoteRefs.length > 0) {
    const ref = canonicalQuoteRefs[0];
    const canonical = getStatuteSectionCanonicalEntry(ref);
    const registrySource = inputSources.find((s) => s.candidate_id === `canonical:${ref.ref_id}`);
    if (canonical && registrySource) {
      const t0 = Date.now();
      const draft = buildStatuteSectionCanonicalQuoteDraft({
        canonicalText: canonical.text,
        description: `הנוסח המחייב של ${ref.section_display} ל${ref.statute_title_he}`,
        sourceRef: registrySource.ref,
      });
      const validation = validateStructuredDraft(draft, allowedRefs);
      const built = validation.draft
        ? buildFootnotedAnswer(validation.draft, inputSources)
        : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
      const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
      return {
        ok: validation.report.ok,
        ms: Date.now() - t_total,
        model_initial: forceModel ?? MODEL_MINI,
        model_final: forceModel ?? MODEL_MINI,
        provider,
        escalated: false,
        sources_passed,
        sources_used: built.used_sources.length,
        answer_markdown: answer,
        used_sources: built.used_sources,
        footnotes: built.footnotes,
        stage_runs: [{
          stage: "drafter_v2_statute_section_canonical_quote_registry",
          model: "deterministic",
          ms: Date.now() - t0,
          ok: validation.report.ok,
        }],
        structured_validation: validation.report,
        structured_draft: validation.draft,
        input_sources: inputSources,
        builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
        quality_warning: computeQualityWarning(answer, { question }),
        missing_anchor_caveat_injected: false,
        lead_ref: { ref: registrySource.ref, reason: "canonical_registry_statute_section", shape },
        missing_anchor_descriptions: [],
        deterministic_branch: "canonical_quote_registry",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String("canonical_quote_registry")),
        schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
      };
    }
  }

  if (statuteSectionLimitationActive) {
    const t0 = Date.now();
    const anchorRefs = inputSources
      .filter((s) => requiredAnchorCandidateIds.has(s.candidate_id))
      .map((s) => s.ref);
    const fallbackRefs = inputSources.slice(0, 1).map((s) => s.ref);
    const draft = buildStatuteSectionLimitationDraft(
      missingAnchors,
      anchorRefs.length > 0 ? anchorRefs : fallbackRefs,
    );
    const validation = validateStructuredDraft(draft, allowedRefs);
    const built = validation.draft
      ? buildFootnotedAnswer(validation.draft, inputSources)
      : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
    const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
    return {
      snippet_budget_report,
      ok: validation.report.ok,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: forceModel ?? MODEL_MINI,
      provider,
      escalated: false,
      sources_passed,
      sources_used: built.used_sources.length,
      answer_markdown: answer,
      used_sources: built.used_sources,
      footnotes: built.footnotes,
      stage_runs: [{
        stage: "drafter_v2_statute_section_guard",
        model: "deterministic",
        ms: Date.now() - t0,
        ok: validation.report.ok,
      }],
      structured_validation: validation.report,
      structured_draft: validation.draft,
      input_sources: inputSources,
      builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
      quality_warning: computeQualityWarning(answer, { question }),
      missing_anchor_caveat_injected: true,
      lead_ref: leadSelection,
      missing_anchor_descriptions: missingAnchors.map((a) => a.description),
      deterministic_branch: "statute_section_limitation",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String("statute_section_limitation")),
      schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
    };
  }

  // Non-seeded deterministic quote fallback. When retrieval verifies direct
  // statute-section text but no canonical registry entry exists, never let the
  // LLM regenerate a quote; emit registered text or refuse.
  const satisfiedStatuteSectionAnchors = opts?.satisfiedStatuteSectionAnchors ?? [];
  if (shape === "quote" && satisfiedStatuteSectionAnchors.length > 0) {
    for (const anchor of satisfiedStatuteSectionAnchors) {
      const canonical = getStatuteSectionCanonicalText(anchor.ref);
      const anchorSource =
        inputSources.find((s) =>
          anchor.candidate_ids.includes(s.candidate_id) &&
          (leadSelection.ref ? s.ref === leadSelection.ref : true)
        ) ??
        inputSources.find((s) => anchor.candidate_ids.includes(s.candidate_id));
      if (!anchorSource) continue;
      const t0 = Date.now();
      const draft = canonical
        ? buildStatuteSectionCanonicalQuoteDraft({
            canonicalText: canonical,
            description: anchor.description,
            sourceRef: anchorSource.ref,
          })
        : buildStatuteSectionLimitationDraft(
            [{ description: anchor.description, is_statute_section: true }],
            [anchorSource.ref],
          );
      const validation = validateStructuredDraft(draft, allowedRefs);
      const built = validation.draft
        ? buildFootnotedAnswer(validation.draft, inputSources)
        : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
      const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
      return {
        ok: validation.report.ok,
        ms: Date.now() - t_total,
        model_initial: forceModel ?? MODEL_MINI,
        model_final: forceModel ?? MODEL_MINI,
        provider,
        escalated: false,
        sources_passed,
        sources_used: built.used_sources.length,
        answer_markdown: answer,
        used_sources: built.used_sources,
        footnotes: built.footnotes,
        stage_runs: [{
          stage: canonical
            ? "drafter_v2_statute_section_canonical_quote"
            : "drafter_v2_statute_section_quote_refusal",
          model: "deterministic",
          ms: Date.now() - t0,
          ok: validation.report.ok,
        }],
        structured_validation: validation.report,
        structured_draft: validation.draft,
        input_sources: inputSources,
        builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
        quality_warning: computeQualityWarning(answer, { question }),
        missing_anchor_caveat_injected: !canonical,
        lead_ref: leadSelection,
        missing_anchor_descriptions: canonical ? [] : [anchor.description],
        deterministic_branch: canonical ? "canonical_quote_verified" : "statute_section_quote_refusal",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String(canonical ? "canonical_quote_verified" : "statute_section_quote_refusal")),
        schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
      };
    }
  }


  // ── Deterministic source-sufficiency gate ─────────────────────────────
  // For case-law synthesis / doctrine / practical-list questions, refuse to
  // synthesize a doctrine out of sources that are not about the asked topic.
  const sufficiency = assessSourceSufficiency({
    question,
    shape,
    sources: inputSources,
    requiredAnchorCandidateIds,
    researchMode: opts?.researchMode ?? null,
    depthMode: opts?.depthMode ?? null,
    sourceUsePlan: opts?.sourceUsePlan ?? null,
  });

  if (sufficiency.applied && !sufficiency.sufficient) {
    const t0 = Date.now();
    const draft = buildInsufficientSourcesDraft(sufficiency);
    const validationRaw = validateStructuredDraft(draft, allowedRefs);
    const validation = validationRaw.report.errors.every((e) => e === "no cited segments")
      ? { draft, report: { ...validationRaw.report, ok: true, errors: [] } }
      : validationRaw;
    const built = validation.draft
      ? buildFootnotedAnswer(validation.draft, inputSources)
      : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
    const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
    return {
      snippet_budget_report,
      ok: validation.report.ok,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: forceModel ?? MODEL_MINI,
      provider,
      escalated: false,
      sources_passed,
      sources_used: built.used_sources.length,
      answer_markdown: answer,
      used_sources: built.used_sources,
      footnotes: built.footnotes,
      stage_runs: [{
        stage: "drafter_v2_source_sufficiency_gate",
        model: "deterministic",
        ms: Date.now() - t0,
        ok: validation.report.ok,
      }],
      structured_validation: validation.report,
      structured_draft: validation.draft,
      input_sources: inputSources,
      builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
      quality_warning: computeQualityWarning(answer, { question }),
      missing_anchor_caveat_injected: true,
      lead_ref: leadSelection,
      missing_anchor_descriptions: missingAnchors.map((a) => a.description),
      deterministic_branch: "insufficient_sources_limitation",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String("insufficient_sources_limitation")),
      sufficiency,
      schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
    };
  }

  // ── Named-doctrine premise / framing validation ───────────────────────
  const framing = assessNamedDoctrineFraming({ question, sources: inputSources });

  // ── Case-law synthesis rendering (prompt-layer only) ──────────────────
  const synthesisPlan = planSynthesisRendering({
    researchMode: opts?.researchMode ?? null,
    sources: inputSources,
    framingCorrectionActive: framing?.framing_correction_required === true,
  });

  // ── Group A empty in case-law synthesis → deterministic limitation ────
  if (synthesisPlan.limitation_required) {
    const t0 = Date.now();
    const synthSufficiency: SufficiencyAssessment = {
      applied: true,
      category: "case_law_synthesis",
      shape: String(shape ?? "analysis"),
      sufficient: false,
      reason: synthesisPlan.reason,
      topic_phrases: sufficiency?.topic_phrases ?? [],
      topical_refs: sufficiency?.topical_refs ?? [],
      topical_authority_refs: [],
      found_titles: synthesisPlan.groups.found_but_not_usable
        .map((r) => inputSources.find((s) => s.ref === r)?.title ?? "")
        .filter(Boolean),
      thin_source: true,
      sufficiency_profile: "case_law_synthesis",
      authority_type_sufficiency_passed: false,
      sufficiency_authority_basis: "insufficient",
      statute_only_answer: false,
      case_law_required: true,
      case_law_missing_but_not_required: false,
      governing_statute_refs: sufficiency?.governing_statute_refs ?? [],
      governing_regulation_refs: sufficiency?.governing_regulation_refs ?? [],
      usable_judgment_refs: [],
      thin_governing_statute_refs: sufficiency?.thin_governing_statute_refs ?? [],
      thin_governing_regulation_refs: sufficiency?.thin_governing_regulation_refs ?? [],
      morphology_domain_match: sufficiency?.morphology_domain_match ?? false,
      normalized_question_tokens: sufficiency?.normalized_question_tokens ?? [],
      normalized_source_tokens: sufficiency?.normalized_source_tokens ?? [],
      practical_steps_thin_authority_passed: false,
      exact_amounts_allowed: false,
      body_topical_refs: sufficiency?.body_topical_refs ?? [],
      body_text_topical_match: sufficiency?.body_text_topical_match ?? false,
      statute_section_requested: sufficiency?.statute_section_requested ?? false,
      depth_mode: opts?.depthMode ?? null,
      doctrinal_secondary_refs: sufficiency?.doctrinal_secondary_refs ?? [],
      doctrinal_ineligible_reasons: sufficiency?.doctrinal_ineligible_reasons ?? {},
      limited_doctrinal_answer: false,
      doctrinal_fallback_combination: null,
      doctrinal_fallback_declined_reason: sufficiency?.doctrinal_fallback_declined_reason ?? null,
      limited_doctrinal_answer_allowed: false,
      narrow_limited_doctrinal_reason: sufficiency?.narrow_limited_doctrinal_reason ?? null,
      acquired_doctrinal_source_count: sufficiency?.acquired_doctrinal_source_count ?? 0,
      direct_doctrinal_source_count: sufficiency?.direct_doctrinal_source_count ?? 0,
      corroborating_source_count: sufficiency?.corroborating_source_count ?? 0,
      primary_authority_missing: sufficiency?.primary_authority_missing ?? true,
      exact_docket_or_case_holding_blocked: true,
      found_only_used_for_support: false,
      branch_before: sufficiency?.branch_before ?? "insufficient_sources_limitation",
      branch_after: "insufficient_sources_limitation",
      planned_user_task_intent: sufficiency?.planned_user_task_intent ?? null,
      planned_answer_strategy: sufficiency?.planned_answer_strategy ?? null,
      research_guidance_sufficiency: false,
      source_buckets: sufficiency?.source_buckets ??
        { read_in_full: [], found_only: [], dropped_unrelated: [] },
    };

    const draft = buildInsufficientSourcesDraft(synthSufficiency);
    const validationRaw = validateStructuredDraft(draft, allowedRefs);
    const validation = validationRaw.report.errors.every((e) => e === "no cited segments")
      ? { draft, report: { ...validationRaw.report, ok: true, errors: [] } }
      : validationRaw;
    const built = validation.draft
      ? buildFootnotedAnswer(validation.draft, inputSources)
      : { answer_markdown: "", footnotes: [], used_sources: [], builder_report: undefined, hierarchy_report: undefined, footnote_render_report: undefined, footnote_density_emission: undefined };
    const answer = scrubNegativeExistenceClaims(built.answer_markdown).text;
    return {
      snippet_budget_report,
      ok: validation.report.ok,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: forceModel ?? MODEL_MINI,
      provider,
      escalated: false,
      sources_passed,
      sources_used: built.used_sources.length,
      answer_markdown: answer,
      used_sources: built.used_sources,
      footnotes: built.footnotes,
      stage_runs: [{
        stage: "drafter_v2_synthesis_no_usable_authority",
        model: "deterministic",
        ms: Date.now() - t0,
        ok: validation.report.ok,
      }],
      structured_validation: validation.report,
      structured_draft: validation.draft,
      input_sources: inputSources,
      builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
      quality_warning: computeQualityWarning(answer, { question }),
      missing_anchor_caveat_injected: true,
      lead_ref: leadSelection,
      missing_anchor_descriptions: missingAnchors.map((a) => a.description),
      deterministic_branch: "insufficient_sources_limitation",
      doctrinal_typing,
      claim_source_match: claimSourceMatchNotRun(String("insufficient_sources_limitation")),
      sufficiency: synthSufficiency,
      schema_failure_reason: validation.report.ok ? undefined : "schema_invalid",
    };
  }



  // topic_aware_claim_source_alignment_v1 — pre-draft claim→source plan. It
  // only constrains which of the already-admitted sources may be cited per
  // claim; it never adds, retrieves or re-admits a source.
  const claim_source_plan: ClaimSourcePlan = buildClaimSourcePlan(
    question,
    claims,
    inputSources,
    { academicMode: opts?.sourceUsePlan?.user_task_intent === "academic_writing" },
  );

  // canonical_registry_discovery_and_representative_source_use_v1 (fix 2) —
  // pick at most one strongest representative source per role per claim from
  // the sources the plan already permits. No source is added or revived.
  const representative_sources: RepresentativeSourceReport =
    buildRepresentativeSourceSelection(question, claims, inputSources, claim_source_plan, {
      run_id: null,
    });


  const userMsg = buildUserMessage(
    question,
    claims,
    inputSources,
    userDocs,
    useAsSource,
    missingAnchors,
    opts?.answerIntent,
    leadSelection.ref,
    sufficiency,
    framing,
    synthesisPlan,
    [
      ...(opts?.facetDirective ?? []),
      ...(literatureOnlyRun
        ? literatureSynthesisDirectives(
          inputSources.slice(0, 8).map((s) => `${s.ref}: ${String(s.title ?? "")}`),
        )
        : []),
      ...(academic_richness_sufficiency?.limitation_directive
        ? [academic_richness_sufficiency.limitation_directive]
        : []),
    ],
    opts?.blockCeiling ?? null,
    opts?.sourceUsePlan ?? null,
    claim_source_plan,
    representative_sources,
  );

  // academic_drafter_prompt_conflict_cleanup_v1 — academic drafts get the
  // shared system prompt with the conflicting hedge/blacklist/bottom-line
  // paragraphs replaced. Every other mode keeps the prompt verbatim.
  const academicGenreForPrompt =
    (opts?.sourceUsePlan?.academic_genre ?? "generic_academic") as AcademicGenre;
  const isAcademicPrompt = opts?.sourceUsePlan?.user_task_intent === "academic_writing";
  const promptCleanup = isAcademicPrompt
    ? applyAcademicPromptCleanup(SYSTEM_PROMPT_V2, academicGenreForPrompt)
    : { prompt: SYSTEM_PROMPT_V2, report: emptyAcademicPromptCleanupReport() };
  const systemPrompt = promptCleanup.prompt;


  const tool = {
    name: "emit_structured_draft",
    description: "Emit the Hebrew legal answer as structured blocks. Code adds footnote markers.",
    parameters: DRAFTER_V2_TOOL_PARAMETERS,
  };

  let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;

  const tryOne = async (
    model: string,
    stage: string,
    maxCompletionTokens?: number,
  ) => {
    const t0 = Date.now();
    let data: unknown = null;
    let raw_text = "";
    let parse_error: string | undefined;
    let http_status = 0;
    let http_error: string | undefined;

    if (provider === "anthropic") {
      const resp = await callAnthropicJsonTool<unknown>({
        model,
        system: systemPrompt,
        user: userMsg,
        tool: {
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        },
      });
      data = resp.data;
      raw_text = resp.raw_text;
      parse_error = resp.parse_error;
      http_status = resp.http_status;
      http_error = resp.http_error;
      lastUsage = resp.usage;
    } else {
      const resp = await callOpenAIJsonTool<unknown>({
        model,
        system: systemPrompt,
        user: userMsg,
        tool,
        maxCompletionTokens,
      });
      data = resp.data;
      raw_text = resp.raw_text;
      parse_error = resp.parse_error;
      http_status = resp.http_status;
      http_error = resp.http_error;
    }

    stage_runs.push({
      stage,
      model,
      ms: Date.now() - t0,
      ok: !!data,
      escalated: stage === "drafter_v2.escalated" || stage === "drafter_v2.truncation_escalated",
      parse_error,
      http_status,
      http_error,
    });
    return { data, raw_text, parse_error };
  };

  const initialModel = forceModel ?? MODEL_MINI;
  let modelUsed = initialModel;
  let escalated = false;
  let maxTokensUsed: number | undefined = DRAFTER_V2_BUDGET_INITIAL;
  let resp = await tryOne(initialModel, "drafter_v2.initial", DRAFTER_V2_BUDGET_INITIAL);


  let parsed = validateStructuredDraft(resp.data, allowedRefs);
  let schema_failure_reason: DrafterV2Result["schema_failure_reason"];
  if (!resp.data) {
    schema_failure_reason = resp.parse_error ? "json_parse" : "no_tool_call";
  } else if (!parsed.report.ok) {
    if (parsed.report.unknown_source_refs.length) schema_failure_reason = "unknown_source_refs";
    else if (parsed.report.forbidden_text_hits.length) schema_failure_reason = "forbidden_markers_in_text";
    else if (parsed.report.cited_segment_count === 0) schema_failure_reason = "no_cited_segments";
    else schema_failure_reason = "schema_invalid";
  }

  if (!parsed.draft && !skipEscalation) {

    escalated = true;
    modelUsed = MODEL_FULL;
    maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
    resp = await tryOne(MODEL_FULL, "drafter_v2.escalated", DRAFTER_V2_BUDGET_RETRY);
    parsed = validateStructuredDraft(resp.data, allowedRefs);
    if (!resp.data) {
      schema_failure_reason = resp.parse_error ? "json_parse" : "no_tool_call";
    } else if (!parsed.report.ok) {
      if (parsed.report.unknown_source_refs.length) schema_failure_reason = "unknown_source_refs";
      else if (parsed.report.forbidden_text_hits.length) schema_failure_reason = "forbidden_markers_in_text";
      else if (parsed.report.cited_segment_count === 0) schema_failure_reason = "no_cited_segments";
      else schema_failure_reason = "schema_invalid";
    } else {
      schema_failure_reason = undefined;
    }
  }


  if (!parsed.draft) {
    return {
      snippet_budget_report,
      ok: false,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: modelUsed,
      provider,
      escalated,
      sources_passed,
      sources_used: 0,
      answer_markdown: "",
      used_sources: [],
      footnotes: [],
      stage_runs,
      error: parsed.report.errors.join("; ") || "structured_draft_invalid",
      raw_text: (resp.raw_text || "").slice(0, 1000),
      structured_validation: parsed.report,
      schema_failure_reason: schema_failure_reason ?? "schema_invalid",
      usage: lastUsage,
    };
  }

  // ── Truncation guard (drafterV2-only) ────────────────────────────────────
  // Run a cheap deterministic completeness check on the parsed draft. If the
  // model closed mid-word / mid-clause, retry once with a larger budget on
  // the same model; only escalate to MODEL_FULL if that retry still fails.
  // Skipped when the caller forces a specific model / suppresses escalation
  // (harness runs) and skipped for the anthropic provider (its token limits
  // are handled elsewhere and it hasn't shown this failure mode).
  let completeness = checkCompleteness(parsed.draft);
  const completeness_initial = completeness;
  let truncation_retry: DrafterV2Result["truncation_retry"] = {
    attempted: false,
    same_model_retry: false,
    escalated_to_full: false,
    retry_ms: 0,
    reasons_initial: completeness_initial.reasons,
  };

  if (completeness.truncated && !skipEscalation && provider === "openai") {
    const t_retry = Date.now();
    truncation_retry.attempted = true;

    // Retry #1 — same model, larger output budget.
    truncation_retry.same_model_retry = true;
    let retryResp = await tryOne(
      initialModel,
      "drafter_v2.truncation_retry",
      DRAFTER_V2_BUDGET_RETRY,
    );
    let retryParsed = validateStructuredDraft(retryResp.data, allowedRefs);
    if (retryParsed.draft) {
      resp = retryResp;
      parsed = retryParsed;
      modelUsed = initialModel;
      maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
      completeness = checkCompleteness(parsed.draft);
    }

    // Retry #2 (escalation) — only if same-model retry failed schema OR
    // still shows a strong truncation signal.
    const stillTruncated = !retryParsed.draft
      || checkCompleteness(retryParsed.draft).truncated;
    if (stillTruncated) {
      truncation_retry.escalated_to_full = true;
      const escResp = await tryOne(
        MODEL_FULL,
        "drafter_v2.truncation_escalated",
        DRAFTER_V2_BUDGET_RETRY,
      );
      const escParsed = validateStructuredDraft(escResp.data, allowedRefs);
      if (escParsed.draft) {
        resp = escResp;
        parsed = escParsed;
        modelUsed = MODEL_FULL;
        escalated = true;
        maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
        completeness = checkCompleteness(parsed.draft);
      }
    }

    truncation_retry.retry_ms = Date.now() - t_retry;
  }

  // router_profiles_v1 — enforce the path's block ceiling deterministically,
  // before any downstream gate or the footnote builder sees the draft.
  const trimmed = applyBlockCeiling(parsed.draft?.blocks ?? [], {
    ceiling: opts?.blockCeiling ?? null,
    dropUnsupported: opts?.dropUnsupportedBlocks === true,
  });
  const router_block_trim = trimmed.report;
  if (router_block_trim.applied && parsed.draft) {
    parsed = { ...parsed, draft: { ...parsed.draft, blocks: trimmed.blocks } };
  }


  // canonical_registry_discovery_and_representative_source_use_v1 (fix 4) —
  // statute dominance on the draft itself: for a square statutory-text
  // question, an admitted + verified statute leads the statutory proposition.
  // Reordering / promoting an already-permitted source only; every gate below
  // still runs on the corrected draft.
  const statuteDominanceApplied = enforceStatuteDominanceOnDraft(parsed.draft, {
    question,
    sources: inputSources,
    allowedByClaim: new Map(
      claim_source_plan.rows.map((r) => [r.claim_id, r.preferred_source_ids]),
    ),
    statutoryClaimIds: claim_source_plan.statute_dominance?.statutory_claims ?? [],
  });
  let statute_dominance_check: StatuteDominanceCheck = statuteDominanceApplied.check;
  const raw_draft_for_funnel = parsed.draft
    ? { ...parsed.draft, blocks: (parsed.draft.blocks ?? []).map((b) => ({ ...b })) }
    : null;

  // metadata_only_holding_gate_v1 — strip metadata-only judgment refs from
  // every cited segment before footnotes are built, so no proposition can rest
  // on a judgment whose body was never read.
  const gated = applyMetadataOnlyHoldingGate(parsed.draft, inputSources);
  const metadata_only_holding_gate = gated.report;


  // claim_source_match_validation_v1 — a source may only stay attached to a
  // block whose claim/facet/legal-area it was actually verified for.
  const academicModeForMatch = opts?.sourceUsePlan?.user_task_intent === "academic_writing";
  const matched = applyClaimSourceMatch(gated.draft ?? parsed.draft, inputSources, {
    mainClaimIds: claims.map((c) => c.claim_id),
    limitedDoctrinalAnswer: sufficiency?.limited_doctrinal_answer === true,
    academicMode: academicModeForMatch,
    question,
  });
  const claim_source_match = matched.report;

  // academic_drafter_source_ref_coverage_v2 — report-only emission measurement
  // on the pre-CSM draft, plus a separate pre-CSM filtering breakdown.
  let academic_drafter_source_ref_emission: AcademicDrafterSourceRefEmission | undefined;
  let pre_csm_source_ref_filtering: PreCsmSourceRefFiltering | undefined;
  if (academicModeForMatch) {
    academic_drafter_source_ref_emission = measureSourceRefEmission(
      parsed.draft,
      buildAcademicSourceRoleMap(question, inputSources),
      String(opts?.sourceUsePlan?.academic_genre ?? "generic_academic"),
    );
    pre_csm_source_ref_filtering = {
      structured_validation_unknown_refs: parsed.report.unknown_source_refs.length,
      metadata_only_holding_gate_drops: metadata_only_holding_gate.stripped_ref_occurrences,
      claim_source_match_drops: claim_source_match.source_ref_mismatch_count,
    };
  }


  // topic_aware_source_role_and_claim_alignment_v1 — block-level claim→source
  // precision: prune class/legal-area mismatches, rank by block relevance and
  // de-compound weak multi-source footnotes. Removal/reordering only.
  const aligned = applyTopicAwareBlockAlignment(
    matched.draft ?? gated.draft ?? parsed.draft,
    inputSources,
    question,
    { academicMode: academicModeForMatch },
  );
  const topic_aware_alignment: TopicAwareAlignmentReport = {
    ...aligned.report,
    source_role_sanity_check: source_role_sanity.rows,
  };
  // topic_aware_claim_source_alignment_v1 — compliance of the raw draft with
  // the pre-draft plan (report-only), and the citation-level kept/dropped view
  // after role + legal-area filtering.
  const drafter_block_source_compliance: DrafterBlockComplianceReport =
    assessDrafterBlockCompliance(
      matched.draft ?? gated.draft ?? parsed.draft,
      claim_source_plan,
    );
  const post_draft_alignment_filter: PostDraftAlignmentFilterReport =
    buildPostDraftAlignmentFilter(topic_aware_alignment);

  // fixes 2 + 3 telemetry — did the representative sources actually survive?
  const representative_source_use = assessRepresentativeSourceUse(
    aligned.draft ?? matched.draft ?? gated.draft ?? parsed.draft,
    representative_sources,
  );
  const drafter_representative_source_compliance = assessDrafterRepresentativeCompliance(
    matched.draft ?? gated.draft ?? parsed.draft,
    representative_sources,
  );

  // academic_richness_last_mile_and_doctrine_mapping_v1 — the builder needs to
  // know which surviving sources were representative-selected so their loss is
  // logged with an explicit reason instead of silently collapsing.
  const representativeRefSet = new Set(
    Object.values(representative_sources.by_claim ?? {}).flat(),
  );
  const representativeCandidateIds = inputSources
    .filter((s) => representativeRefSet.has(s.ref))
    .map((s) => s.candidate_id);
  const built = buildFootnotedAnswer(
    aligned.draft ?? matched.draft ?? gated.draft ?? parsed.draft as StructuredDraft,
    inputSources,
    {
      referenceOnlyRefs: claim_source_match.reference_only_refs ?? [],
      academicMode: academicModeForMatch,
      representativeCandidateIds,
    },
  );

  const limitation_note_alignment: LimitationNoteAlignment = assessLimitationNoteAlignment(
    "answer",
    inputSources,
    topic_aware_alignment,
    matched.limitation_text ?? "",
  );




  // academic_writing_intent_and_drafting_v1 — the negative-existence scrub
  // rewrites prose into retrieval-scoped "במקורות שאותרו לא נמצא עיגון…"
  // phrasing, which is exactly the register an academic draft must avoid.
  const academicPrimary = opts?.sourceUsePlan?.user_task_intent === "academic_writing";
  const academicLimited =
    academicPrimary && (sufficiency?.reason ?? "").includes("academic_writing_draft_allowed");

  // Rule 1.10 — Hebrew number ranges must be written high→low in source order.
  const baseAnswer = stripInternalRefTokens(
    academicPrimary
      ? normalizeHebrewNumberRanges(built.answer_markdown)
      : scrubNegativeExistenceClaims(
        normalizeHebrewNumberRanges(built.answer_markdown),
      ).text,
  );

  // substance_based_doctrinal_sufficiency_v1 (guardrail 2) — the
  // "found only" list is not emitted mechanically. It appears only when the
  // answer actually rests on a limited pack, or when the gate stripped
  // support from the draft, i.e. when the limitation is material.
  const referenceOnlyText =
    (sufficiency?.limited_doctrinal_answer === true ||
        metadata_only_holding_gate.blocks_stripped > 0 ||
        metadata_only_holding_gate.blocks_left_unsupported > 0)
      ? referenceOnlySection(metadata_only_holding_gate.reference_only_sources)
      : "";
  const limitedDoctrinalText = sufficiency?.limited_doctrinal_answer === true
    ? (sufficiency?.limited_doctrinal_answer_allowed === true
      ? NARROW_LIMITED_DOCTRINAL_NOTICE_HE
      : LIMITED_DOCTRINAL_ANSWER_NOTICE_HE)
    : "";

  // academic_draft_presentation_hygiene_v1 — for academic writing every legacy
  // limitation block is suppressed and replaced by a single "הערת עבודה" note,
  // and the body is normalized to prose without raw URLs.
  let academic_presentation_hygiene: AcademicHygieneReport | undefined;
  let academic_style_model: (AcademicStyleModelReport & { answer_words?: number }) | undefined;
  let academic_prompt_cleanup: DrafterV2Report["academic_prompt_cleanup"];
  let answer_markdown: string;
  let non_academic_limitation_note: NonAcademicLimitationNote | undefined;

  if (academicPrimary) {
    const suppressed = [
      academicLimited ? 1 : 0,
      referenceOnlyText ? 1 : 0,
      limitedDoctrinalText ? 1 : 0,
      matched.limitation_text ? 1 : 0,
    ].reduce((a, b) => a + b, 0);
    const hygiene = applyAcademicPresentationHygiene(baseAnswer, {
      genre: (opts?.sourceUsePlan?.academic_genre ?? "generic_academic") as AcademicGenre,
      question,
      thinSources: academicLimited || sufficiency?.limited_doctrinal_answer === true ||
        built.used_sources.length <= 2,
      followUpTitles: metadata_only_holding_gate.reference_only_sources.map((s) => s.title),
      noticesSuppressed: suppressed,
    });
    answer_markdown = hygiene.answer;
    // topic_aware_source_role_and_claim_alignment_v1 — the single academic
    // work note must also state when no directly on-point judgment was found.
    if (limitation_note_alignment.revised) {
      answer_markdown = answer_markdown.replace(
        /\*הערת עבודה: ([^*]+)\*\s*$/,
        (_m, body: string) =>
          `*הערת עבודה: ${body.trim()} לא אותר פסק דין העוסק ישירות בדוקטרינה הנדונה; הביסוס כאן נשען על חקיקה וספרות משפטית.*`,
      );
    }

    academic_presentation_hygiene = hygiene.report;
    academic_style_model = {
      ...buildAcademicStyleGuideBlock(
        (opts?.sourceUsePlan?.academic_genre ?? "generic_academic") as AcademicGenre,
        academicStyleOptions(inputSources, sufficiency),
      ).report,
      answer_words: answer_markdown.split(/\s+/).filter(Boolean).length,
    };
    // academic_drafter_prompt_conflict_cleanup_v1 telemetry.
    academic_prompt_cleanup = {
      ...promptCleanup.report,
      rhythm_rules_as_ceilings: true,
      hygiene_softened: hygiene.report.hygiene_softened,
      paragraph_trimmed: hygiene.report.paragraph_trimmed,
      bullets_converted_or_preserved: hygiene.report.bullets_converted_or_preserved,
      drift_paragraphs_dropped: hygiene.report.drift_paragraphs_dropped,
    };



  } else {
    // non_academic_source_binding_and_csm_v1 — ordinary Q&A gets exactly one
    // accurate limitation notice instead of stacked generic boilerplate.
    const primaryCited = built.used_sources.some((u) =>
      u.citable_as === "judgment" || u.citable_as === "statute" ||
      u.citable_as === "regulation"
    );
    const merged = consolidateLimitationNotes({
      question_id: "answer",
      parts: [limitedDoctrinalText, matched.limitation_text ?? ""],
      primary_cited: primaryCited,
      no_direct_caselaw: limitation_note_alignment.revised,
    });
    non_academic_limitation_note = merged.report;
    answer_markdown = baseAnswer + referenceOnlyText + merged.text;
  }



  const synthesis_rendering = reportSynthesisRendering({
    plan: synthesisPlan,
    answerMarkdown: answer_markdown,
    sources: inputSources,
    usedRefs: new Set(
      built.used_sources
        .map((u) => inputSources.find((s) => s.candidate_id === u.candidate_id)?.ref)
        .filter((r): r is string => !!r),
    ),
  });
  if (claim_source_match.academic_authority_alignment) {
    claim_source_match.academic_authority_alignment.rendered_footnotes = built.footnotes.length;
    (claim_source_match.academic_authority_alignment as unknown as Record<string, unknown>)
      .pack_fit_dropped = academic_pack_fit_dropped;
  }
  // academic_literature_richness_without_fixed_source_count_v1 telemetry
  if (claim_source_match.academic_authority_alignment) {
    const a = claim_source_match.academic_authority_alignment as unknown as Record<string, unknown>;
    a.literature_pack_selection = academic_pack_selection;
    a.research_richness_sufficiency = academic_richness_sufficiency;
    a.literature_only_request = literatureOnlyRun;
  }


  const footnotes = built.footnotes.map((fn) => ({
    ...fn,
    text: normalizeHebrewNumberRanges(fn.text),
  }));

  // fix 5 — per-source last-mile funnel, and fix 4's final verification.
  const citedRefsFinal = built.used_sources
    .map((u) => inputSources.find((s) => s.candidate_id === u.candidate_id)?.ref)
    .filter((r): r is string => !!r);
  statute_dominance_check = verifyStatuteDominanceInFootnotes(
    statute_dominance_check,
    citedRefsFinal,
  );
  const source_last_mile_funnel: SourceLastMileFunnelReport = buildSourceLastMileFunnel({
    sources: inputSources,
    representative: representative_sources,
    rawDraft: raw_draft_for_funnel,
    postCsmDraft: matched.draft ?? gated.draft ?? parsed.draft,
    postAlignmentDraft: aligned.draft ?? matched.draft ?? gated.draft ?? parsed.draft,
    citedRefs: citedRefsFinal,
  });

  return {
    non_academic_limitation_note,
    snippet_budget_report,
    ok: true,
    ms: Date.now() - t_total,
    model_initial: forceModel ?? MODEL_MINI,
    model_final: modelUsed,
    provider,
    escalated,
    sources_passed,
    sources_used: built.used_sources.length,
    answer_markdown,
    used_sources: built.used_sources,
    footnotes,
    stage_runs,
    structured_validation: parsed.report,
    structured_draft: parsed.draft,
    input_sources: inputSources,
    builder_report: built.builder_report,
      hierarchy_report: built.hierarchy_report,
      footnote_render_report: built.footnote_render_report,
      footnote_density_emission: built.footnote_density_emission,
      footnote_materialization: built.footnote_materialization,
      footnote_builder_richness_summary: built.footnote_builder_richness_summary,

    quality_warning: computeQualityWarning(answer_markdown, {
      question,
      source_context: inputSources
        .map((s) => `${s.title}\n${s.snippet ?? ""}\n${(s.supported_points ?? []).join("\n")}`)
        .join("\n")
        .slice(0, 20000),
    }),
    usage: lastUsage,
    missing_anchor_caveat_injected: missingAnchors.length > 0,
    lead_ref: leadSelection,
    missing_anchor_descriptions: missingAnchors.map((a) => a.description),
    deterministic_branch: academicLimited ? "academic_limited_draft" : undefined,
    academic_presentation_hygiene,
    academic_style_model,
    academic_prompt_cleanup,
    academic_drafter_source_ref_emission,
    pre_csm_source_ref_filtering,



    sufficiency,
    named_doctrine_framing: framing,
    synthesis_rendering,
    metadata_only_holding_gate,
    router_block_trim,

    claim_source_match,
    doctrinal_typing,
    topic_aware_alignment,
    limitation_note_alignment,
    claim_source_plan,
    representative_source_selection: representative_sources,
    representative_source_use,
    drafter_representative_source_compliance,
    statute_dominance_check,
    source_last_mile_funnel,
    drafter_block_source_compliance,
    post_draft_alignment_filter,





    completeness,
    completeness_initial,
    truncation_retry,
    max_completion_tokens_used: maxTokensUsed,
  };
}
