// Deterministic Israeli statute-title + section-marker detection.
//
// Scans free text for references of the form
//   "פקודת מס הכנסה ... סעיף 32(9)"  /  "סעיף 1 לחוק-יסוד: כבוד האדם וחירותו"
// and returns normalized StatuteSectionRef records the required-anchor
// mechanism uses to force retrieval of the actual statutory text of the
// specific section (not a policy circular, article, or adjacent statute).

export interface StatuteSectionRef {
  /** Stable slug for anchor_id, e.g. "income_tax-s32-9". */
  ref_id: string;
  /** Registry key of the matched statute. */
  statute_key: string;
  /** Canonical display title (used in drafter caveat text). */
  statute_title_he: string;
  /** Section marker as written by the user (canonicalized), e.g. "32(9)". */
  section: string;
  /** Human display of the marker, e.g. "סעיף 32(9)". */
  section_display: string;
  /** Regexps that a candidate title must match to count as "this statute". */
  title_patterns: RegExp[];
  /**
   * Strings that a candidate snippet/text must contain to count as covering
   * the specific section. Multiple accepted forms (with/without parens).
   */
  section_variants: string[];
  /** Suggested retrieval queries — Hebrew canonical phrasings. */
  suggested_queries: string[];
}

type DirectTextRule = {
  /** Terms that must all appear in the candidate text after normalization. */
  all?: string[];
  /** At least one of these alternatives must appear. */
  any?: string[];
};

interface StatuteDef {
  key: string;
  title_he: string;
  /** Patterns that must match a candidate's title/display title. */
  title_patterns: RegExp[];
  /** Hebrew phrasings used to build retrieval queries. */
  query_prefixes: string[];
}

// Registry — curated, additive. Kept small on purpose; adjacent statutes
// (e.g. חוק הפיקוח על שירותים פיננסיים) intentionally do NOT sit here so a
// question about פקודת מס הכנסה §32(9) cannot be satisfied by them.
const STATUTE_REGISTRY: StatuteDef[] = [
  {
    key: "income_tax_ordinance",
    title_he: "פקודת מס הכנסה",
    title_patterns: [/פקודת\s+מס\s+הכנסה/],
    query_prefixes: ["פקודת מס הכנסה"],
  },
  {
    key: "companies_law",
    title_he: "חוק החברות",
    title_patterns: [/חוק\s+החברות(?!\s+הממשלתיות)/],
    query_prefixes: ["חוק החברות"],
  },
  {
    key: "penal_law",
    title_he: "חוק העונשין",
    title_patterns: [/חוק\s+העונשין/],
    query_prefixes: ["חוק העונשין"],
  },
  {
    key: "contracts_general_law",
    title_he: "חוק החוזים (חלק כללי)",
    title_patterns: [/חוק\s+החוזים(?:\s*\(\s*חלק\s+כללי\s*\))?/],
    query_prefixes: ["חוק החוזים (חלק כללי)", "חוק החוזים חלק כללי"],
  },
  {
    key: "torts_ordinance",
    title_he: "פקודת הנזיקין",
    title_patterns: [/פקודת\s+הנזיקין/],
    query_prefixes: ["פקודת הנזיקין"],
  },
  {
    key: "basic_law_dignity",
    title_he: "חוק-יסוד: כבוד האדם וחירותו",
    title_patterns: [/חוק[-\s]?יסוד\s*:?\s*כבוד\s+האדם\s+ו?חירותו/],
    query_prefixes: ["חוק-יסוד: כבוד האדם וחירותו"],
  },
  {
    key: "basic_law_occupation",
    title_he: "חוק-יסוד: חופש העיסוק",
    title_patterns: [/חוק[-\s]?יסוד\s*:?\s*חופש\s+העיסוק/],
    query_prefixes: ["חוק-יסוד: חופש העיסוק"],
  },
  {
    key: "consumer_protection_law",
    title_he: "חוק הגנת הצרכן",
    title_patterns: [/חוק\s+הגנת\s+הצרכן/],
    query_prefixes: ["חוק הגנת הצרכן"],
  },
  {
    key: "contract_remedies_law",
    title_he: "חוק החוזים (תרופות בשל הפרת חוזה)",
    title_patterns: [/חוק\s+החוזים\s*\(\s*תרופות/],
    query_prefixes: ["חוק החוזים (תרופות בשל הפרת חוזה)"],
  },
  {
    key: "torts_liability_law",
    title_he: "חוק איסור לשון הרע",
    title_patterns: [/חוק\s+איסור\s+לשון\s+הרע/],
    query_prefixes: ["חוק איסור לשון הרע"],
  },
];

// Section marker: `סעיף 32`, `סעיף 32(9)`, `סעיף 254א`, `סעיף 3(א)(2)`.
// Capture group 1 = the marker body (digits + optional Hebrew letter + optional
// parenthesized parts).
const SECTION_RE_G = /סעיף\s+(\d+[א-ת]?(?:\s*\([^)]{1,10}\))*)/g;

function normalizeSectionMarker(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function buildSectionVariants(section: string): string[] {
  // Accept several ways the marker may appear in a snippet.
  const s = normalizeSectionMarker(section);
  const out = new Set<string>([
    s,
    `סעיף ${s}`,
    `סעיף${s}`,
    `§ ${s}`,
    `§${s}`,
  ]);
  // If section has parenthesized subparts, also accept the base digits alone
  // (many statute HTML dumps render subparts elsewhere in the DOM).
  const base = s.match(/^\d+[א-ת]?/);
  if (base) {
    out.add(base[0]);
    out.add(`סעיף ${base[0]}`);
    // Israeli statute typesetting frequently renders sections as "N. text"
    // (a numbered heading) rather than the word "סעיף". Accept that form —
    // safe because the outer predicate still requires the candidate title
    // to match the specific statute.
    out.add(`${base[0]}. `);
    out.add(`\n${base[0]}.`);
  }
  return [...out];
}

function normalizeForDirectText(s: string): string {
  return String(s ?? "")
    .replace(/[־–—]/g, "-")
    .replace(/["״׳']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function directTextRuleFor(ref: StatuteSectionRef): DirectTextRule | null {
  if (ref.statute_key === "basic_law_dignity" && normalizeSectionMarker(ref.section) === "1") {
    return {
      all: [
        "זכויות היסוד של האדם בישראל מושתתות",
        "ההכרה בערך האדם",
        "בקדושת חייו",
        "בהיותו בן-חורין",
      ],
    };
  }

  if (ref.statute_key === "income_tax_ordinance" && normalizeSectionMarker(ref.section) === "32(9)") {
    return {
      all: ["בעל שליטה"],
      any: ["10%", "עשרה אחוזים", "אמצעי השליטה", "לפחות באחד מאמצעי השליטה"],
    };
  }

  return null;
}

/**
 * Detect statute-title + section-marker pairs in free text.
 *
 * Detection rule (narrow on purpose): both a registered statute title AND at
 * least one `סעיף N...` marker must appear in the same text. We do NOT try to
 * pair each marker to a specific statute by proximity — if a question names
 * one statute and one section, that is the pair. If it names several sections
 * of the same statute, we emit one anchor per section.
 */
export function detectStatuteSections(text: string): StatuteSectionRef[] {
  const src = String(text ?? "");
  if (!src) return [];
  const statutes = STATUTE_REGISTRY.filter((s) => s.title_patterns.some((re) => re.test(src)));
  if (statutes.length === 0) return [];
  const sections: string[] = [];
  for (const m of src.matchAll(SECTION_RE_G)) {
    sections.push(normalizeSectionMarker(m[1]));
  }
  if (sections.length === 0) return [];
  const uniqSections = [...new Set(sections)];

  const out: StatuteSectionRef[] = [];
  const seen = new Set<string>();
  for (const st of statutes) {
    for (const sec of uniqSections) {
      const ref_id = `${st.key}-s${sec.replace(/[^\w]+/g, "-").replace(/-+$/g, "")}`;
      if (seen.has(ref_id)) continue;
      seen.add(ref_id);
      const suggested = st.query_prefixes.flatMap((p) => [
        `${p} סעיף ${sec}`,
        `${p} ${sec}`,
        `סעיף ${sec} ל${p}`,
      ]);
      out.push({
        ref_id,
        statute_key: st.key,
        statute_title_he: st.title_he,
        section: sec,
        section_display: `סעיף ${sec}`,
        title_patterns: st.title_patterns,
        section_variants: buildSectionVariants(sec),
        suggested_queries: [...new Set(suggested)],
      });
    }
  }
  return out;
}

/**
 * Predicate: does a candidate (by title + snippet) plausibly carry the actual
 * statutory text of the specific section?
 *
 * Requires BOTH:
 *   - the candidate's title matches one of the statute's title patterns; and
 *   - the candidate's snippet contains one of the section variants.
 *
 * A title-only match (e.g. a landing page for the ordinance) is NOT enough —
 * that is what causes drafters to answer from the wrong section.
 */
export function candidateSatisfiesStatuteSection(
  fields: { title?: string | null; snippet?: string | null; url?: string | null },
  ref: StatuteSectionRef,
): boolean {
  const title = String(fields.title ?? "");
  const snippet = String(fields.snippet ?? "");
  const titleOk = ref.title_patterns.some((re) => re.test(title));
  if (!titleOk) return false;
  const hay = `${title}\n${snippet}`;
  return ref.section_variants.some((v) => v.length >= 2 && hay.includes(v));
}

/**
 * Stronger predicate for definition/quote safety: a candidate may satisfy the
 * statute-section anchor partially by title+section marker, but it should only
 * count as direct section text if the extracted title/snippet also exposes the
 * actual provision language (or a curated marker set for that section).
 */
export function candidateHasDirectStatuteSectionText(
  fields: { title?: string | null; snippet?: string | null; url?: string | null },
  ref: StatuteSectionRef,
): boolean {
  if (!candidateSatisfiesStatuteSection(fields, ref)) return false;
  const rule = directTextRuleFor(ref);
  if (!rule) return true;

  const hay = normalizeForDirectText(`${fields.title ?? ""}\n${fields.snippet ?? ""}`);
  const allOk = (rule.all ?? []).every((term) => hay.includes(normalizeForDirectText(term)));
  const anyTerms = rule.any ?? [];
  const anyOk = anyTerms.length === 0 || anyTerms.some((term) => hay.includes(normalizeForDirectText(term)));
  return allOk && anyOk;
}
