/**
 * legal-research-v2 — canonical authority registry DATA ONLY.
 *
 * Copied (data, not logic) from the V1 core authority registry. No doctrine
 * triggers, no roles, no query seeding, no ranking: V2 treats registry
 * presence as a *clue* for `lookup_authority`, never as verification.
 */

export interface CanonicalAuthorityRow {
  authority_id: string;
  kind: "case" | "statute";
  label: string;
  docket?: string;
  match_terms: string[];
}

export const CANONICAL_AUTHORITIES: readonly CanonicalAuthorityRow[] = [
  { authority_id: "basic_law_dignity_s8", kind: "statute", label: "חוק-יסוד: כבוד האדם וחירותו, סעיף 8 (פסקת ההגבלה)", docket: undefined, match_terms: ["כבוד האדם וחירותו", "פסקת ההגבלה"] },
  { authority_id: "hcj_6821_93_mizrahi", kind: "case", label: "בג\"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי", docket: "6821/93", match_terms: ["6821/93", "בנק המזרחי"] },
  { authority_id: "hcj_1715_97_investment_managers", kind: "case", label: "בג\"ץ 1715/97 לשכת מנהלי ההשקעות נ' שר האוצר", docket: "1715/97", match_terms: ["1715/97", "לשכת מנהלי ההשקעות"] },
  { authority_id: "hcj_389_80_dapei_zahav", kind: "case", label: "בג\"ץ 389/80 דפי זהב נ' רשות השידור", docket: "389/80", match_terms: ["389/80", "דפי זהב"] },
  { authority_id: "hcj_935_89_ganor", kind: "case", label: "בג\"ץ 935/89 גנור נ' היועץ המשפטי לממשלה", docket: "935/89", match_terms: ["935/89", "גנור"] },
  { authority_id: "hcj_5658_23_reasonableness_amendment", kind: "case", label: "בג\"ץ 5658/23 (ביטול עילת הסבירות)", docket: "5658/23", match_terms: ["5658/23", "התנועה למען איכות השלטון"] },
  { authority_id: "hcj_135_75_sai_tex", kind: "case", label: "בג\"ץ 135/75 סאי-טקס נ' שר המסחר והתעשייה", docket: "135/75", match_terms: ["135/75", "סאי-טקס", "סאי טקס"] },
  { authority_id: "hcj_5018_91_gadot", kind: "case", label: "בג\"ץ 5018/91 גדות תעשיות פטרוכימיה נ' ממשלת ישראל", docket: "5018/91", match_terms: ["5018/91", "גדות תעשיות"] },
  { authority_id: "hcj_585_01_kalachman", kind: "case", label: "בג\"ץ 585/01 קלכמן נ' ראש המטה הכללי", docket: "585/01", match_terms: ["585/01", "קלכמן"] },
  { authority_id: "hcj_1000_92_bavli", kind: "case", label: "בג\"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול", docket: "1000/92", match_terms: ["1000/92", "בבלי"] },
  { authority_id: "hcj_8638_03_sima_amir", kind: "case", label: "בג\"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול", docket: "8638/03", match_terms: ["8638/03", "סימה אמיר"] },
  { authority_id: "law_spousal_property", kind: "statute", label: "חוק יחסי ממון בין בני זוג, תשל\"ג-1973", docket: undefined, match_terms: ["יחסי ממון בין בני זוג"] },
  { authority_id: "law_rabbinical_jurisdiction", kind: "statute", label: "חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953", docket: undefined, match_terms: ["שיפוט בתי דין רבניים"] },
  { authority_id: "contracts_law_s12", kind: "statute", label: "חוק החוזים (חלק כללי), תשל\"ג-1973, סעיף 12", docket: undefined, match_terms: ["חוק החוזים (חלק כללי)", "סעיף 12"] },
  { authority_id: "dn_7_81_pnidar", kind: "case", label: "ד\"נ 7/81 פנידר נ' קסטרו", docket: "7/81", match_terms: ["7/81", "פנידר", "קסטרו"] },
  { authority_id: "ca_6370_00_kal_binyan", kind: "case", label: "ע\"א 6370/00 קל בנין בע\"מ נ' ע.ר.מ. רעננה", docket: "6370/00", match_terms: ["6370/00", "קל בנין"] },
  { authority_id: "companies_law_s6", kind: "statute", label: "חוק החברות, תשנ\"ט-1999, סעיף 6", docket: undefined, match_terms: ["חוק החברות", "סעיף 6"] },
  { authority_id: "ca_4263_04_mishmar_haemek", kind: "case", label: "ע\"א 4263/04 קיבוץ משמר העמק נ' עו\"ד מנור", docket: "4263/04", match_terms: ["4263/04", "משמר העמק"] },
  { authority_id: "ca_2773_04_atar_nitzba", kind: "case", label: "ע\"א 2773/04 עטר נ' נצבא חברה להתנחלות", docket: "2773/04", match_terms: ["2773/04", "נצבא"] },
  { authority_id: "hcj_6396_96_zakin", kind: "case", label: "בג\"ץ 6396/96 זקין נ' ראש עיריית באר-שבע", docket: "6396/96", match_terms: ["6396/96", "זקין"] },
];
