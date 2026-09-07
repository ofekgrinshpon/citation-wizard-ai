// web_judgment_source_classification_and_role_admission_v1
//
// Document-evidence classification. The host is only ONE signal: a discovered
// page is typed as a judgment or as scholarship from the evidence carried by
// the document itself (docket, court identity, party names, judicial panel,
// judgment structure / author, article title, journal or faculty context,
// bibliographic metadata).
//
// This layer is ADMISSION-ONLY. Judgment identity validation, source
// integrity, body-quality requirements, the metadata-only holding gate, the
// verifier, CSM and alignment all still run downstream and are untouched.

/**
 * Hebrew writers frequently type non-final letters where a final form belongs
 * (בג"צ instead of בג"ץ, דנ"מ / עע"מ variants, ...). Normalising finals makes
 * prefix matching robust without loosening the docket shape itself.
 */
export function normalizeHebrewFinals(s: string): string {
  return (s || "")
    .replace(/[ךכ]/g, "כ")
    .replace(/[םמ]/g, "מ")
    .replace(/[ןנ]/g, "נ")
    .replace(/[ףפ]/g, "פ")
    .replace(/[ץצ]/g, "צ")
    .replace(/[״”"]/g, '"')
    .replace(/[׳’']/g, "'");
}

/** Case-type prefix + docket, tolerant of final/non-final spelling. */
const CASE_PREFIX_DOCKET_RE =
  /(?:בג"?צ|דנג"?צ|בשג"?צ|עע"?מ|ע"?א|ע"?פ|ע"?מ|ע"?ע|ע"?ב|ע"?ש|רע"?א|רע"?פ|רע"?ב|דנ"?א|דנ"?פ|דנ"?מ|בש"?פ|בש"?א|בר"?מ|בר"?ע|בע"?מ|תמ"?ש|תלה"?מ|תפ"?ח|רמ"?ש|עמ"?ש|עמ"?נ|עת"?מ|עס"?ק|סע"?ש|דב"?ע|עב"?ל|ה"?פ|ת"?א|ת"?פ|ת"?ק|עה"?ס)\s*(?:\([^)]{1,40}\)\s*)?(\d{1,6}(?:[\/\-]\d{1,4}){1,2})/;

const BARE_DOCKET_RE = /\b\d{1,6}[\/\-]\d{2,4}(?:[\/\-]\d{1,4})?\b/;

/** Party-name shape: "X נ' Y". */
const PARTIES_RE = /\S\s+נ'\s+\S/;

/** Court identity words. */
const COURT_IDENTITY_RE =
  /(?:בית\s*המשפט\s*העליון|בג"?צ|בית\s*הדין\s*הרבני|בית\s*הדין\s*הארצי|בית\s*הדין\s*האזורי|בית\s*המשפט\s*המחוזי|בית\s*משפט\s*לענייני\s*משפחה|בשבתו\s*כבית\s*דין\s*גבוה\s*לצדק)/;

/** Judgment structure / panel markers, usually visible in the snippet. */
const JUDGMENT_STRUCTURE_RE =
  /(?:פסק[\s\-]?דין|פסק'?\s*דין|החלטה|כב'?\s*השופט|כבוד\s*השופט|השופטת|המשנה\s*לנשיא|הנשיא|לפני:?\s*כב|בפני\s*הרכב|ערעור\s*על\s*פסק|העתירה\s*נדחית|הערעור\s*מתקבל)/;

/** Plainly secondary / marketing writing. */
const COMMENTARY_TITLE_RE =
  /(?:מאמר|בלוג|טור\s|פרשנות|ניוזלטר|עדכון\s*לקוחות|מדריך|שאלות\s*ותשובות|כל\s*מה\s*שצריך\s*לדעת|משרד\s*עורכי\s*דין|ייעוץ\s*משפטי|צור\s*קשר|blog|newsletter|guide|faq)/i;

const COMMENTARY_PATH_RE =
  /\/(?:blog|news|magazine|column|press|media|about|contact|service|services|category|tag|author|faq|guide)(?:\/|$|\.)/i;

export interface DocumentEvidenceInput {
  url: string;
  title: string;
  snippet?: string;
  /** Class produced by the host table, used only as one more signal. */
  host_class?: string;
}

export interface JudgmentEvidence {
  is_judgment: true;
  docket: string;
  matched_in: "title" | "url";
  signals: string[];
  signal_count: number;
}

/**
 * Judgment detection from the document. Requires a real docket in the title
 * or URL plus at least one further judgment signal (court identity, party
 * names, judgment structure, judicial panel, substantial body).
 * Fails closed for commentary/marketing pages and for pages that only
 * name-drop a docket in a snippet.
 */
export function detectJudgmentEvidence(
  input: DocumentEvidenceInput,
): JudgmentEvidence | null {
  const title = normalizeHebrewFinals((input.title || "").trim());
  const rawUrl = (input.url || "").trim();
  const snippet = normalizeHebrewFinals((input.snippet || "").trim());
  if (!title && !rawUrl) return null;

  if (COMMENTARY_TITLE_RE.test(title)) return null;
  let path = "";
  try { path = new URL(rawUrl).pathname; } catch { path = rawUrl; }
  if (COMMENTARY_PATH_RE.test(path)) return null;

  let decodedUrl = rawUrl;
  try { decodedUrl = decodeURIComponent(rawUrl); } catch { /* keep raw */ }
  decodedUrl = normalizeHebrewFinals(decodedUrl);

  let docket = "";
  let matched_in: "title" | "url" | "" = "";
  const titleMatch = title.match(CASE_PREFIX_DOCKET_RE);
  if (titleMatch) {
    docket = titleMatch[1];
    matched_in = "title";
  } else {
    const urlMatch = decodedUrl.match(CASE_PREFIX_DOCKET_RE);
    if (urlMatch && BARE_DOCKET_RE.test(decodedUrl)) {
      docket = urlMatch[1];
      matched_in = "url";
    }
  }
  if (!docket || !matched_in) return null;

  const signals: string[] = [`docket_in_${matched_in}`];
  const hay = `${title} ${snippet}`;
  if (PARTIES_RE.test(hay)) signals.push("party_names");
  if (COURT_IDENTITY_RE.test(hay)) signals.push("court_identity");
  if (JUDGMENT_STRUCTURE_RE.test(hay)) signals.push("judgment_structure");
  if (/\.(?:pdf|doc|docx|rtf)$/i.test(path) && snippet.length >= 200) {
    signals.push("substantial_document_body");
  }
  if (input.host_class === "court_case" || input.host_class === "official_primary") {
    signals.push("host_supports_case_law");
  }

  // Docket alone is not enough — a second, independent judgment signal is
  // required so that pages merely mentioning a case never pass.
  if (signals.length < 2) return null;

  return { is_judgment: true, docket, matched_in, signals, signal_count: signals.length };
}

// ─── Scholarship ────────────────────────────────────────────────────────────

const JOURNAL_RE =
  /(?:משפטים|עיוני\s*משפט|הפרקליט|משפט\s*וממשל|דין\s*ודברים|מחקרי\s*משפט|משפט\s*ועסקים|מעשי\s*משפט|תיאוריה\s*וביקורת|עלי\s*משפט|המשפט|משפט\s*חברה\s*ותרבות|law\s*review|journal\s*of\s*law)/i;

const INSTITUTION_RE =
  /(?:הפקולטה\s*למשפטים|בית\s*הספר\s*למשפטים|אוניברסיט|המכון\s*הישראלי\s*לדמוקרטיה|מרכז\s*מחקר|working\s*paper|faculty\s*of\s*law|research\s*institute)/i;

const BIBLIOGRAPHIC_RE =
  /(?:כרך\s*[א-תivxlc\d]|גיליון\s*\d|עמ'?\s*\d|\(\d{4}\)|doi:|issn|תשע"?[א-ת]|תשפ"?[א-ת])/i;

const AUTHOR_RE = /(?:^|[\s|·—-])([א-ת]{2,12}\s+[א-ת]{2,15})(?:\s*[,|·—-]|\s+["״])/;

export interface ScholarshipEvidence {
  is_scholarship: true;
  signals: string[];
  detected_journal_or_institution: string | null;
}

/**
 * Scholarship detection from the document. Requires at least two independent
 * academic signals (journal/institution context, bibliographic metadata,
 * author + article title, academic PDF body). `class_unknown` alone never
 * rejects an otherwise clearly identifiable academic source.
 */
export function detectScholarshipEvidence(
  input: DocumentEvidenceInput,
): ScholarshipEvidence | null {
  const title = (input.title || "").trim();
  const snippet = (input.snippet || "").trim();
  const url = (input.url || "").trim();
  if (!title) return null;
  if (COMMENTARY_TITLE_RE.test(title)) return null;

  let path = "";
  try { path = new URL(url).pathname; } catch { path = url; }
  const hay = `${title} ${snippet}`;

  const signals: string[] = [];
  let detected: string | null = null;

  const journal = hay.match(JOURNAL_RE);
  if (journal) { signals.push("journal_context"); detected = journal[0]; }
  const inst = hay.match(INSTITUTION_RE);
  if (inst) { signals.push("institution_context"); detected = detected ?? inst[0]; }
  if (BIBLIOGRAPHIC_RE.test(hay)) signals.push("bibliographic_metadata");
  if (AUTHOR_RE.test(title)) signals.push("author_and_title");
  if (/\.pdf$/i.test(path) && (journal || inst || BIBLIOGRAPHIC_RE.test(hay))) {
    signals.push("academic_pdf");
  }
  if (input.host_class === "academic" || input.host_class === "publisher") {
    signals.push("host_supports_scholarship");
  }

  if (signals.length < 2) return null;
  return { is_scholarship: true, signals, detected_journal_or_institution: detected };
}

/** Classes that may be re-typed by document evidence. Never `bad`. */
export const RECLASSIFIABLE_CLASSES = new Set([
  "unknown",
  "academic",
  "publisher",
  "discovery_only",
  "commercial_secondary",
  "news",
  "government_report",
]);
