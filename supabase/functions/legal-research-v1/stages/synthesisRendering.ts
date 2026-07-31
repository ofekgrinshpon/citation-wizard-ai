// Case-law synthesis rendering (drafter-prompt layer only).
//
// Scope: when research_mode === "case_law_synthesis" and the LLM drafter runs,
// inject a small mode-specific rendering directive that turns the synthesis
// metadata already present on each source (synthesis_role, citable_as,
// text_usability, has_holding_text) into a line-of-authority answer skeleton.
//
// This module changes NOTHING upstream: no retrieval, planner, verifier,
// sufficiency, integrity, acquisition, footnote or deterministic-branch logic.

import type { DrafterInputSource } from "./drafter.ts";

export const CASE_LAW_SYNTHESIS_MODE = "case_law_synthesis";

export interface SynthesisRenderingPlan {
  applied: boolean;
  reason:
    | "not_synthesis_mode"
    | "framing_correction_active"
    | "no_citable_judgments"
    | "applied";
  usable_judgment_refs: string[];
  metadata_only_judgment_refs: string[];
  leading_refs: string[];
  applying_refs: string[];
  limiting_refs: string[];
  statutory_refs: string[];
  commentary_refs: string[];
  directive_lines: string[];
}

function isJudgment(s: DrafterInputSource): boolean {
  return String(s.citable_as ?? "") === "judgment" || s.is_judgment_document === true;
}

/**
 * A source may support holding / application / limitation language ONLY if it is
 * a judgment, carries real text (full_text | substantive_excerpt) AND is flagged
 * as containing holding text. All three conditions are required.
 */
function isUsableText(s: DrafterInputSource): boolean {
  const u = String(s.text_usability ?? "");
  return (
    isJudgment(s) &&
    (u === "full_text" || u === "substantive_excerpt") &&
    s.has_holding_text === true
  );
}

const LEADING_ROLES = new Set(["leading_candidate", "leading_authority"]);
const APPLYING_ROLES = new Set(["applying_candidate", "applying_authority"]);
const LIMITING_ROLES = new Set([
  "limiting_candidate",
  "distinguishing_candidate",
  "limiting_authority",
]);
const STATUTORY_ROLES = new Set(["statutory_background", "primary_statute"]);

/**
 * Build the synthesis rendering plan + prompt directive.
 * `framingCorrectionActive` short-circuits the plan: the named-doctrine
 * framing correction owns the answer structure and must not be overridden.
 */
export function planSynthesisRendering(opts: {
  researchMode: string | null | undefined;
  sources: DrafterInputSource[];
  framingCorrectionActive: boolean;
}): SynthesisRenderingPlan {
  const empty = {
    usable_judgment_refs: [] as string[],
    metadata_only_judgment_refs: [] as string[],
    leading_refs: [] as string[],
    applying_refs: [] as string[],
    limiting_refs: [] as string[],
    statutory_refs: [] as string[],
    commentary_refs: [] as string[],
    directive_lines: [] as string[],
  };

  if (opts.researchMode !== CASE_LAW_SYNTHESIS_MODE) {
    return { applied: false, reason: "not_synthesis_mode", ...empty };
  }
  if (opts.framingCorrectionActive) {
    return { applied: false, reason: "framing_correction_active", ...empty };
  }

  const judgments = opts.sources.filter(isJudgment);
  const usable = judgments.filter(isUsableText);
  const metaOnly = judgments.filter((s) => !isUsableText(s));

  const byRole = (set: Set<string>) =>
    opts.sources.filter((s) => set.has(String(s.synthesis_role ?? ""))).map((s) => s.ref);
  // Application / limitation layers may only be built from judgments that carry
  // usable holding text; metadata-only judgments and commentary cannot create them.
  const byUsableRole = (set: Set<string>) =>
    opts.sources
      .filter((s) => set.has(String(s.synthesis_role ?? "")) && isUsableText(s))
      .map((s) => s.ref);

  const leading_refs = byRole(LEADING_ROLES);
  const applying_refs = byUsableRole(APPLYING_ROLES);
  const limiting_refs = byUsableRole(LIMITING_ROLES);
  const statutory_refs = byRole(STATUTORY_ROLES);
  const commentary_refs = opts.sources
    .filter((s) => !isJudgment(s) && !STATUTORY_ROLES.has(String(s.synthesis_role ?? "")))
    .map((s) => s.ref);

  if (judgments.length === 0) {
    return {
      applied: false,
      reason: "no_citable_judgments",
      ...empty,
      commentary_refs,
      statutory_refs,
    };
  }

  const usableRefs = usable.map((s) => s.ref);
  const metaRefs = metaOnly.map((s) => s.ref);

  const L: string[] = [];
  L.push("");
  L.push(
    'מצב מענה: סקירת פסיקה (case-law synthesis). התשובה חייבת להיבנות כקו-פסיקה (line of authority) ולא כחיבור דוקטרינרי כללי. השתמש בכותרות הבאות בדיוק כלשונן ובסדר הזה, ודלג על כותרת שאין לה מקורות. הטקסט שאחרי הקו המפריד הוא הנחיה פנימית ואסור להעתיק אותו אל תוך הכותרת:',
  );
  L.push('  1. כותרת: "שורה תחתונה" — הכלל הנוהג כיום, במשפט או שניים.');
  L.push(
    '  2. כותרת: "המקור הפסיקתי המרכזי שנמצא" — נקוב בשם ובמספר ההליך של פסק/י הדין המובילים בגוף הטקסט, וכתוב מה כל אחד מהם קובע בפועל. מותר רק לגבי פסקי דין שסומנו כבעלי טקסט שמיש.',
  );
  L.push(
    '  3. כותרת: "יישומים בפסיקה שנמצאה" — פסקי דין מיישמים בעלי טקסט שמיש בלבד, בקבוצה נפרדת.',
  );
  L.push(
    '  4. כותרת: "מגבלות והבחנות" — פסקי דין מסייגים/מבחינים בעלי טקסט שמיש בלבד, בקבוצה נפרדת.',
  );
  L.push('  5. כותרת: "הרקע החקיקתי" — הוראות חוק רלוונטיות, בנפרד מהפסיקה.');
  L.push('  6. כותרת: "מה לא ניתן לקבוע מהמקורות" — פערים שנותרו.');
  L.push("");
  L.push("כללי ציטוט מחייבים במצב זה:");
  L.push(
    "  • מותר לנקוב בשמות פסקי דין רק אם הם מופיעים ברשימת המקורות שסופקה לך. אין להוסיף פסקי דין מהזיכרון, גם אם הם 'הלכות ידועות'.",
  );
  L.push(
    "  • ניסוח של הלכה, יישום, סייג או כל מהלך דוקטרינרי מותר אך ורק על בסיס פסק דין שמופיע ברשימת 'מקורות פסיקה עם טקסט שמיש'. כל מקור אחר אינו יכול לשאת מהלך כזה.",
  );
  L.push(
    "  • לגבי פסק דין שסומן metadata_only: אסור לכתוב לגביו 'נקבע בו', 'הוחל בו', 'הוגבל בו', 'נפסק כי', 'קבע כי' או כל ניסוח הלכתי דומה. מותר להזכיר אותו אך ורק כהערת מקור מוגבל, בנוסח: \"נמצא אזכור/מקור מטא־דאטה לפסק הדין X, אך לא די טקסט אופרטיבי כדי לגזור ממנו הלכה.\"",
  );
  L.push(
    "  • ספרות ופרשנות אינן יוצרות שכבת יישום או סייג בפני עצמן. הן מותרות רק להסבר או הקשר, ורק אחרי שהוצגה סמכות פסיקתית שמישה.",
  );
  L.push("  • חוק אינו הלכה פסוקה — אין להציג נוסח חוק כקביעה של בית משפט.");

  if (usable.length === 0) {
    L.push(
      "  • אזהרה: לאף פסק דין ברשימה אין טקסט הלכתי שמיש. אל תציג אף קביעה כהלכה שנפסקה, אל תכתוב פרק יישומים או מגבלות, וציין במפורש שרק מטא-נתונים/אזכורים של פסקי דין אותרו.",
    );
  } else if (usable.length === 1) {
    L.push(
      `  • רק לפסק דין אחד יש טקסט שמיש (${usableRefs[0]}). ציין במפורש שהתשובה נסמכת בעיקר עליו ועל מקורות תומכים מוגבלים, ואל תרחיב ממנו כלל גורף.`,
    );
  }
  if (metaRefs.length > 0) {
    L.push(
      `  • מקורות פסיקה עם מטא-נתונים בלבד (אין להסיק מהם הלכה, יישום או סייג; רק הערת מקור מוגבל): ${metaRefs.join(", ")}.`,
    );
  }
  if (usableRefs.length > 0) {
    L.push(`  • מקורות פסיקה עם טקסט שמיש: ${usableRefs.join(", ")}.`);
  }
  L.push("");
  L.push("תפקידי סמכות שהוקצו למקורות (השתמש בהם לצורך הקיבוץ בלבד):");
  const roleLine = (label: string, refs: string[]) => {
    if (refs.length) L.push(`  • ${label}: ${refs.join(", ")}`);
  };
  roleLine("מוביל", leading_refs);
  roleLine("מיישם", applying_refs);
  roleLine("מסייג/מבחין", limiting_refs);
  roleLine("רקע חקיקתי", statutory_refs);
  roleLine("ספרות/פרשנות", commentary_refs);

  return {
    applied: true,
    reason: "applied",
    usable_judgment_refs: usableRefs,
    metadata_only_judgment_refs: metaRefs,
    leading_refs,
    applying_refs,
    limiting_refs,
    statutory_refs,
    commentary_refs,
    directive_lines: L,
  };
}

// ── Post-draft telemetry ────────────────────────────────────────────────────

export interface SynthesisRenderingReport {
  synthesis_rendering_applied: boolean;
  reason: SynthesisRenderingPlan["reason"];
  named_cases_in_body: number;
  usable_judgments_named: number;
  metadata_only_sources_used_as_holdings: boolean;
  commentary_used_as_primary_authority: boolean;
  named_case_keys: string[];
}

/** Docket-style identifiers, e.g. ע"א 52/80, בג״ץ 6698/95, בע"מ 5620/24. */
const DOCKET_RE = /([א-ת]{1,4}["״'׳]?[א-ת]?)\s*(\d{1,5}\/\d{2,4})/g;

function docketKeys(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(DOCKET_RE)) out.add(m[2]);
  return out;
}

// Attribution-style holding language only (a metadata-only case must never carry
// these). Bare nouns like "הלכה"/"פסיקה" are excluded — they appear in legitimate
// limited-source notes such as "לא זוהה טקסט הלכתי".
const HOLDING_VERBS =
  /(נקבע|נפסק|קבע כי|פסק כי|קובע כי|הוחל|החיל|הוגבל|הגביל|סייג את|סויג|הבחין בין|יישם|יושם)/;

// Markers of the prescribed limited-source note; when present around the case
// name, the mention is explicitly non-operative and must not be flagged.
const LIMITED_SOURCE_MARKERS =
  /(מטא[־\-–]?דאטה|מטא[־\-–]?נתונים|אזכור|לא די טקסט|לא זוהה|לא נמצא טקסט|אינו כולל טקסט|מוגבל)/;


export function reportSynthesisRendering(opts: {
  plan: SynthesisRenderingPlan;
  answerMarkdown: string;
  sources: DrafterInputSource[];
  usedRefs: Set<string>;
}): SynthesisRenderingReport {
  if (!opts.plan.applied) {
    return {
      synthesis_rendering_applied: false,
      reason: opts.plan.reason,
      named_cases_in_body: 0,
      usable_judgments_named: 0,
      metadata_only_sources_used_as_holdings: false,
      commentary_used_as_primary_authority: false,
      named_case_keys: [],
    };
  }
  const bodyKeys = docketKeys(opts.answerMarkdown);
  const named_case_keys: string[] = [];
  let usable_judgments_named = 0;
  let metadataAsHolding = false;

  for (const s of opts.sources) {
    if (!isJudgment(s)) continue;
    const keys = docketKeys(`${s.title} ${s.snippet ?? ""}`.slice(0, 400));
    const titleKeys = docketKeys(s.title);
    const match = [...(titleKeys.size ? titleKeys : keys)].find((k) => bodyKeys.has(k));
    if (!match) continue;
    named_case_keys.push(match);
    if (isUsableText(s)) {
      usable_judgments_named++;
    } else {
      // Metadata-only judgment named next to holding language → flag,
      // unless the mention sits inside the prescribed limited-source note.
      const idx = opts.answerMarkdown.indexOf(match);
      if (idx >= 0) {
        const window = opts.answerMarkdown.slice(Math.max(0, idx - 200), idx + 200);
        if (HOLDING_VERBS.test(window) && !LIMITED_SOURCE_MARKERS.test(window)) {
          metadataAsHolding = true;
        }
      }
    }
  }

  const named_cases_in_body = new Set(named_case_keys).size;
  const commentaryCited = opts.sources.some(
    (s) => !isJudgment(s) &&
      !STATUTORY_ROLES.has(String(s.synthesis_role ?? "")) &&
      opts.usedRefs.has(s.ref),
  );

  return {
    synthesis_rendering_applied: opts.plan.applied,
    reason: opts.plan.reason,
    named_cases_in_body,
    usable_judgments_named,
    metadata_only_sources_used_as_holdings: metadataAsHolding,
    commentary_used_as_primary_authority: named_cases_in_body === 0 && commentaryCited,
    named_case_keys: Array.from(new Set(named_case_keys)),
  };
}
