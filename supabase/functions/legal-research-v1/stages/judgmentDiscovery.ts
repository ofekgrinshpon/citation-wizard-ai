// Judgment-focused discovery queries (Parts 2 & 3).
//
// Scope: discovery only. Deterministically appends a small number of
// judgment-targeting search queries for modes where the answer must rest on
// real judgments (case-law synthesis, doctrine explanation, survey-like
// questions). This is *source-type targeting*, not a doctrine dictionary:
// no case names, no holdings, no allowlists.

import type { AnalyzerOutput, Query } from "../lib/types.ts";

/** Survey-like phrasings: "כתוב סקירה", "סקירת פסיקה", "התפתחות הפסיקה" … */
export const SURVEY_CUE_RE =
  /(כתוב(?:י|ו)?\s+סקירה|סקירת\s+(?:ה?פסיקה|ה?דין|ספרות)|סקירה\s+(?:משפטית|אקדמית)|התפתחות\s+(?:ה)?(?:פסיקה|הלכה|דוקטרינה)|מה\s+(?:ה)?פסיקה\s+אומרת|מהי\s+ה?דוקטרינה|כיצד\s+התפתח|איך\s+התפתח|מצב\s+(?:ה)?משפט(?:י)?\s+הנוהג)/;

const JUDGMENT_DISCOVERY_MODES = new Set([
  "case_law_synthesis",
  "doctrine_explanation",
]);

/** Phrases stripped when deriving the topic from the question. */
const CUE_STRIP_RE = new RegExp(
  [
    "כתוב(?:י|ו)?\\s+סקירה(?:\\s+(?:משפטית|אקדמית))?(?:\\s+(?:על|בנושא|בעניין|בדבר|לגבי))?",
    "סקירת\\s+(?:ה)?(?:פסיקה|דין|ספרות)(?:\\s+(?:על|בנושא|בעניין|בדבר|לגבי))?",
    "התפתחות\\s+(?:ה)?(?:פסיקה|הלכה|דוקטרינה)(?:\\s+(?:של|בעניין|בנושא|לגבי|ב))?",
    "מה\\s+(?:ה)?פסיקה\\s+(?:אומרת|קובעת|גורסת)(?:\\s+(?:על|לגבי|בעניין|בנושא|בדבר))?",
    "מה\\s+נקבע\\s+ב(?:ה)?פסיקה(?:\\s+(?:על|לגבי|בעניין|בנושא))?",
    "מה\\s+(?:ה)?הלכה\\s+(?:לגבי|בעניין|בנוגע\\s+ל|בדבר)",
    "מהי\\s+(?:ה)?דוקטרינה(?:\\s+(?:של|בעניין|בנושא))?",
    "כיצד\\s+(?:היא\\s+)?התפתחה?",
    "איך\\s+(?:היא\\s+)?התפתחה?",
    "כיצד\\s+(?:ה)?פסיקה\\s+(?:מתייחסת|מתמודדת)(?:\\s+(?:אל|עם|ל))?",
    "עמדת\\s+(?:ה)?פסיקה(?:\\s+(?:על|לגבי|בעניין))?",
    "הסבר(?:י|ו)?(?:\\s+(?:על|את|לגבי))?",
    "מהו|מהי|מה\\s+זה",
  ].join("|"),
  "g",
);

/** Derive a compact topic phrase from the question (deterministic, no NLP). */
export function extractDiscoveryTopic(
  question: string,
  analyzer?: AnalyzerOutput | null,
): string {
  let t = (question || "")
    .replace(/[?？]/g, " ")
    .replace(CUE_STRIP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop leading connectors left behind by stripping.
  t = t.replace(/^(?:על|לגבי|בעניין|בנושא|בדבר|של|את|ו)\s+/, "").trim();
  const words = t.split(/\s+/).filter(Boolean).slice(0, 8);
  t = words.join(" ").trim();
  if (t.length < 3) {
    t = (analyzer?.claims?.[0]?.text_he ?? question).split(/\s+/).slice(0, 8).join(" ");
  }
  return t;
}

export interface JudgmentDiscoveryResult {
  enabled: boolean;
  mode: string | null;
  survey_like: boolean;
  topic: string | null;
  queries: Query[];
  /** Telemetry: the query strings issued. */
  judgment_discovery_queries: string[];
  layers: string[];
}

interface Spec {
  layer: string;
  suffix: string;
  reason: string;
  perplexity_only?: boolean;
}

const BASE_SPECS: Spec[] = [
  { layer: "leading", suffix: "פסק דין עליון", reason: "איתור פסיקה מנחה של בית המשפט העליון" },
  { layer: "leading", suffix: 'הלכה פסוקה ע"א בג"ץ דנ"א', reason: "איתור ההלכה הפסוקה המכוננת" },
  {
    layer: "official_document",
    suffix: "site:supremedecisions.court.gov.il Download",
    reason: "איתור מסמך פסק דין רשמי להורדה",
    perplexity_only: true,
  },
  {
    layer: "official_document",
    suffix: "site:court.gov.il filetype:pdf פסק דין",
    reason: "איתור קובץ פסק דין רשמי",
    perplexity_only: true,
  },
];

const SURVEY_SPECS: Spec[] = [
  { layer: "applying", suffix: "יישום ההלכה פסיקה מאוחרת נסיבות", reason: "פסיקה מיישמת" },
  { layer: "limiting", suffix: "חריג סייג צמצום הבחנה דעת מיעוט", reason: "פסיקה מסייגת/מבחינה" },
];

/**
 * Build judgment-focused discovery queries. Returns an empty result for modes
 * that are not judgment-bearing surveys — nothing else in the pipeline changes.
 */
export function buildJudgmentDiscoveryQueries(
  question: string,
  mode: string | null,
  analyzer: AnalyzerOutput,
): JudgmentDiscoveryResult {
  const survey_like = SURVEY_CUE_RE.test(question || "");
  const eligible = (mode && JUDGMENT_DISCOVERY_MODES.has(mode)) || survey_like;
  if (!eligible) {
    return {
      enabled: false,
      mode: mode ?? null,
      survey_like,
      topic: null,
      queries: [],
      judgment_discovery_queries: [],
      layers: [],
    };
  }

  const topic = extractDiscoveryTopic(question, analyzer);
  const claim_id = analyzer.claims?.[0]?.claim_id ?? "c1";
  const specs = survey_like ? [...BASE_SPECS, ...SURVEY_SPECS] : BASE_SPECS;

  const queries: Query[] = specs.map((s, i) => ({
    claim_id,
    role: "binding_case_law",
    query_he: `${topic} ${s.suffix}`.trim(),
    targets: s.perplexity_only ? ["perplexity"] : ["local_db", "perplexity"],
    expected_source_type: "case",
    reason: s.reason,
    metadata: {
      judgment_discovery: true,
      judgment_discovery_layer: s.layer,
      judgment_discovery_index: i,
      survey_like,
    },
  }));

  return {
    enabled: true,
    mode: mode ?? null,
    survey_like,
    topic,
    queries,
    judgment_discovery_queries: queries.map((q) => q.query_he),
    layers: [...new Set(specs.map((s) => s.layer))],
  };
}
