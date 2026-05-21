// Pure shape-check assertions for legal-qa regression harness.
// No I/O. Each function returns { id, passed, detail } so the runner can
// aggregate, diff against `known_failing_assertions`, and produce stable
// greppable output.
//
// Stable assertion IDs (DO NOT rename — referenced in baseline JSONs):
//   COUNT_TOTAL_FN          — total_footnotes within tolerance band
//   COUNT_ANCHORED          — anchored_count >= total - 2
//   COUNT_RERANK_DROPS      — metadata.rerank_drops is an array (field exists)
//   SHAPE_DUP_STATUTE       — no two legislation FNs share an identity key
//   SHAPE_TRUNC             — no citation ends in truncation pattern (התש?., mid-word)
//   SHAPE_NAKED_ANAPHORA    — no citation begins with חוק זה / תקנות אלו / etc.
//   SHAPE_MIN_TOKENS        — legislation citations have ≥2 Hebrew tokens after keyword
//   SHAPE_RULE37_INTEGRITY  — לעיל ה"ש N points at a non-fallback, non-truncated FN
//   SHAPE_LEG_NO_SUPRA      — no legislation_* FN is referenced via לעיל ה"ש N
//   SHAPE_BODY_COVERAGE     — every [N] in body has a footnote, no orphans either way

// ---------- Identity-key helpers (mirror compute_verified_source_identity) ----------

const CASE_PREFIX_RE = /(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+(\d+\/\d+)/;

// Source-type buckets used across assertions.
// Backend uses values like "israeli_law", "legislation_primary", "regulation",
// "case_law", "caselaw", "literature", etc. Treat any of these as legislation:
const LEGISLATION_TYPES = new Set([
  "israeli_law",
  "legislation",
  "legislation_primary",
  "legislation_secondary",
  "regulation",
  "regulations",
  "basic_law",
  "ordinance",
]);

export function isLegislationFn(footnote) {
  const t = String(footnote?.source_type || "").toLowerCase();
  if (!t) return false;
  if (LEGISLATION_TYPES.has(t)) return true;
  if (t.startsWith("legislation")) return true;
  if (t.includes("law") && !t.includes("case")) return true;
  if (t.includes("regulation")) return true;
  return false;
}

export function computeIdentityKey(footnote) {
  const sourceType = String(footnote?.source_type || "").toLowerCase();
  const citation = String(footnote?.citation || "").trim();
  const name = String(footnote?.source_name || "").trim();
  if (!citation && !name) return null;

  if (sourceType === "caselaw" || sourceType.includes("case")) {
    const m = citation.match(CASE_PREFIX_RE);
    if (m) return `case:${m[1]}`;
    return `case:${normalize(name)}|${normalize(citation).slice(0, 60)}`;
  }

  if (isLegislationFn(footnote)) {
    // Extract section if present
    const sectionMatch = citation.match(/^סעיף\s+([\dא-ת()./\\–-]+)\s+ל/);
    const section = sectionMatch ? sectionMatch[1] : null;
    let lawName = citation.replace(/^סעיף\s+[\dא-ת()./\\–-]+\s+ל/, "");
    // Strip year/gazette/page suffixes
    lawName = lawName.replace(
      /,\s*(התש[א-ת"״'׳\-–]+\s*[–-]\s*\d{4}|\d{4}|ס["״]ח\s*\d+.*|ק["״]ת\s*\d+.*|עמ[.]?\s*\d+.*|עמוד\s*\d+.*)$/g,
      ""
    );
    lawName = normalize(lawName);
    if (lawName) {
      return `law:${lawName}${section ? `|section:${normalize(section)}` : ""}`;
    }
    return `law:${normalize(name)}|${normalize(citation).slice(0, 60)}`;
  }

  return `lit:${normalize(name)}|${normalize(citation).slice(0, 60)}`;
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------- Assertion implementations ----------

export function assertCountTotal(fnList, band) {
  const n = Array.isArray(fnList) ? fnList.length : 0;
  const min = band?.min ?? 0;
  const max = band?.max ?? Infinity;
  const passed = n >= min && n <= max;
  return {
    id: "COUNT_TOTAL_FN",
    passed,
    detail: passed ? `total=${n} within [${min},${max}]` : `total=${n} OUTSIDE [${min},${max}]`,
  };
}

export function assertAnchored(fnList, minDelta) {
  const total = Array.isArray(fnList) ? fnList.length : 0;
  const anchored = (fnList || []).filter((f) => typeof f?.url === "string" && f.url.length > 0).length;
  const required = total + (minDelta ?? -2);
  const passed = anchored >= required;
  return {
    id: "COUNT_ANCHORED",
    passed,
    detail: `anchored=${anchored}/${total} (need ≥${required})`,
  };
}

export function assertRerankDrops(metadata) {
  const drops = metadata?.rerank_drops;
  const passed = Array.isArray(drops);
  return {
    id: "COUNT_RERANK_DROPS",
    passed,
    detail: passed ? `rerank_drops is array (len=${drops.length})` : `rerank_drops missing/wrong type (got ${typeof drops})`,
  };
}

export function assertNoDupStatute(fnList) {
  const legFns = (fnList || []).filter(isLegislationFn);
  const seen = new Map();
  const dups = [];
  for (const fn of legFns) {
    const key = computeIdentityKey(fn);
    if (!key) continue;
    if (seen.has(key)) {
      dups.push({ key, fns: [seen.get(key), fn.number ?? "?"] });
    } else {
      seen.set(key, fn.number ?? "?");
    }
  }
  return {
    id: "SHAPE_DUP_STATUTE",
    passed: dups.length === 0,
    detail: dups.length === 0
      ? `no duplicates across ${legFns.length} legislation FNs`
      : `duplicates: ${dups.map((d) => `[${d.fns.join(",")}]→${d.key}`).join(" ; ")}`,
  };
}

const TRUNC_PATTERNS = [
  /התש[א-ת]?\.\s*$/,                  // "התשע." truncation
  /,\s*$/,                             // trailing comma
  /\s+ל\s*$/,                          // "סעיף X ל" with no law name
];

// A legislation citation that begins with the year prefix (no statute name) is broken.
// e.g. "התשכ\"ג-1963." with no preceding "חוק/פקודת/תקנות".
const YEAR_ONLY_RE = /^\s*התש[א-ת]["״]?[א-ת]?[\s\-–]*\d{4}\.?\s*$/;

export function assertNoTruncation(fnList) {
  const bad = [];
  for (const fn of fnList || []) {
    const cit = String(fn?.citation || "");
    if (!cit) continue;
    let isBad = false;
    for (const pat of TRUNC_PATTERNS) {
      if (pat.test(cit)) { isBad = true; break; }
    }
    if (!isBad && isLegislationFn(fn) && YEAR_ONLY_RE.test(cit)) {
      isBad = true;
    }
    if (isBad) bad.push({ n: fn.number ?? "?", tail: cit.slice(-30) });
  }
  return {
    id: "SHAPE_TRUNC",
    passed: bad.length === 0,
    detail: bad.length === 0
      ? "no truncated citations"
      : `truncated: ${bad.map((b) => `FN#${b.n} ends "...${b.tail}"`).join(" ; ")}`,
  };
}

// Note: \b doesn't work on Hebrew chars in JS regex; use end-of-string-or-non-letter lookahead.
const ANAPHORA_RE = /^(חוק\s+(זה|אחר|זו)|תקנות\s+(אלו|אלה|הללו|הא?לה)|הפקודה\s+ה(נ["״]ל|אמורה|זו)|החוק\s+ה(נ["״]ל|אמור|זה)|הוראות\s+ה(נ["״]ל|אמורות))(?=\s|,|\.|$|[^א-ת])/;

export function assertNoNakedAnaphora(fnList) {
  const bad = [];
  for (const fn of fnList || []) {
    const cit = String(fn?.citation || "").trim();
    if (ANAPHORA_RE.test(cit)) bad.push({ n: fn.number ?? "?", head: cit.slice(0, 30) });
  }
  return {
    id: "SHAPE_NAKED_ANAPHORA",
    passed: bad.length === 0,
    detail: bad.length === 0
      ? "no anaphoric statute names"
      : `anaphora: ${bad.map((b) => `FN#${b.n} "${b.head}..."`).join(" ; ")}`,
  };
}

const STATUTE_KEYWORD_RE = /^(חוק[- ]יסוד\s*:\s*|חוק\s+|פקודת\s+|תקנות\s+)/;

export function assertMinTokens(fnList) {
  const bad = [];
  for (const fn of fnList || []) {
    if (!isLegislationFn(fn)) continue;
    const cit = String(fn?.citation || "").replace(/^סעיף\s+\S+\s+ל/, "").trim();
    if (!STATUTE_KEYWORD_RE.test(cit)) continue;
    // Count tokens before the year/gazette suffix; keep parentheticals (e.g. "חוק החוזים (חלק כללי)").
    const after = cit.replace(STATUTE_KEYWORD_RE, "").replace(/,\s*(התש|\d{4}|ס["״]ח|ק["״]ת).*$/, "").trim();
    const tokens = after.split(/[\s()]+/).filter((t) => /[א-ת]/.test(t));
    if (tokens.length < 2) bad.push({ n: fn.number ?? "?", after: after.slice(0, 30) });
  }
  return {
    id: "SHAPE_MIN_TOKENS",
    passed: bad.length === 0,
    detail: bad.length === 0
      ? "all legislation FNs have ≥2 hebrew tokens"
      : `too short: ${bad.map((b) => `FN#${b.n} "${b.after}"`).join(" ; ")}`,
  };
}

const SUPRA_REF_RE = /לעיל\s+ה["״]ש\s+(\d{1,3})/g;

export function assertRule37Integrity(answerBody, fnList) {
  const bad = [];
  const byNumber = new Map((fnList || []).map((f) => [String(f.number), f]));
  let m;
  const re = new RegExp(SUPRA_REF_RE.source, "g");
  while ((m = re.exec(answerBody || "")) !== null) {
    const n = m[1];
    const fn = byNumber.get(n);
    if (!fn) {
      bad.push(`לעיל ה"ש ${n} → no FN exists`);
      continue;
    }
    if (fn.metadata?.fallback === true) {
      bad.push(`לעיל ה"ש ${n} → FN flagged fallback`);
      continue;
    }
    const cit = String(fn.citation || "");
    if (TRUNC_PATTERNS.some((p) => p.test(cit))) {
      bad.push(`לעיל ה"ש ${n} → FN citation truncated`);
    }
  }
  return {
    id: "SHAPE_RULE37_INTEGRITY",
    passed: bad.length === 0,
    detail: bad.length === 0 ? "all supra refs valid" : bad.join(" ; "),
  };
}

export function assertLegislationNoSupra(answerBody, fnList) {
  const byNumber = new Map((fnList || []).map((f) => [String(f.number), f]));
  const bad = [];
  let m;
  const re = new RegExp(SUPRA_REF_RE.source, "g");
  while ((m = re.exec(answerBody || "")) !== null) {
    const n = m[1];
    const fn = byNumber.get(n);
    if (fn && isLegislationFn(fn)) {
      bad.push(`לעיל ה"ש ${n} → legislation FN (rule 37.5 violation)`);
    }
  }
  return {
    id: "SHAPE_LEG_NO_SUPRA",
    passed: bad.length === 0,
    detail: bad.length === 0 ? "no legislation referenced via supra" : bad.join(" ; "),
  };
}

// Map Unicode superscript digits to their ASCII equivalents.
const SUP_MAP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

function extractBodyMarkers(answerBody, fnNumsSet) {
  const nums = new Set();
  const text = String(answerBody || "");
  // [N] markers (legacy)
  const bracketRe = /\[(\d{1,3})\]/g;
  let m;
  while ((m = bracketRe.exec(text)) !== null) nums.add(Number(m[1]));
  // Superscript runs: greedy split against known footnote numbers so adjacent
  // single-digit markers (¹², ³⁴) aren't misread as multi-digit footnotes.
  const supRe = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
  const fnNums = fnNumsSet ?? new Set();
  const maxFnLen = Math.max(1, ...[...fnNums].map((n) => String(n).length));
  const splitRun = (digits) => {
    const dp = (i) => {
      if (i === digits.length) return [];
      for (let L = Math.min(maxFnLen, digits.length - i); L >= 1; L--) {
        const n = Number(digits.slice(i, i + L));
        if (fnNums.has(n)) {
          const rest = dp(i + L);
          if (rest) return [n, ...rest];
        }
      }
      return null;
    };
    return dp(0);
  };
  while ((m = supRe.exec(text)) !== null) {
    const ascii = [...m[0]].map((c) => SUP_MAP[c] ?? "").join("");
    if (!ascii) continue;
    const parts = splitRun(ascii);
    if (parts) {
      for (const n of parts) nums.add(n);
    } else {
      // Unparseable run: surface as a single number so the orphan check fires.
      nums.add(Number(ascii));
    }
  }
  return nums;
}

export function assertBodyCoverage(answerBody, fnList) {
  const fnNums = new Set((fnList || []).map((f) => Number(f.number)).filter((n) => Number.isFinite(n)));
  const bodyNums = extractBodyMarkers(answerBody, fnNums);
  const orphansInBody = [...bodyNums].filter((n) => !fnNums.has(n));
  const orphansInList = [...fnNums].filter((n) => !bodyNums.has(n));
  const passed = orphansInBody.length === 0 && orphansInList.length === 0;
  const parts = [];
  if (orphansInBody.length) parts.push(`body refs missing FN: [${orphansInBody.join(",")}]`);
  if (orphansInList.length) parts.push(`FNs unreferenced: [${orphansInList.join(",")}]`);
  return {
    id: "SHAPE_BODY_COVERAGE",
    passed,
    detail: passed ? `coverage clean (${fnNums.size} FNs)` : parts.join(" ; "),
  };
}

// ---------- Phase 6.5 role-telemetry assertions (opt-in per fixture) ----------

export function assertRolePlanPresent(metadata) {
  const plan = metadata?.research_safeguards?.legal_research_plan;
  const ok = !!plan && Array.isArray(plan.required_roles) && plan.required_roles.length >= 1;
  return {
    id: "ROLE_PLAN_PRESENT",
    passed: ok,
    detail: ok
      ? `strategy=${plan.answer_strategy} required=${plan.required_roles.length} fallback=${plan.used_fallback}`
      : "no legal_research_plan in metadata",
  };
}

export function assertRoleGateEvaluated(metadata) {
  const g = metadata?.research_safeguards?.source_pack_gate_v2;
  const ok = !!g && g.mode !== "off";
  return {
    id: "DOCTRINAL_GATE_ATTEMPTED",
    passed: ok,
    detail: ok
      ? `mode=${g.mode} satisfied=${g.satisfied} gaps=${(g.gaps||[]).length}`
      : "gate V2 not evaluated (mode=off or missing)",
  };
}

export function assertNoPlaceholderAsPrimary(metadata) {
  // Read role+quality off the (un-sanitized) source_pack_summary v2 entries.
  // We only flag a violation when a `must` role is filled exclusively by
  // placeholder-quality cards; pure placeholder presence is allowed.
  const plan = metadata?.research_safeguards?.legal_research_plan;
  const pack = metadata?.source_pack_summary;
  if (!plan || !Array.isArray(pack?.coreSources)) {
    return { id: "NO_PLACEHOLDER_AS_PRIMARY", passed: true, detail: "no plan or pack — skipped" };
  }
  const all = [
    ...(pack.coreSources || []),
    ...(pack.supportingSources || []),
    ...(pack.secondarySources || []),
  ];
  const offenders = [];
  for (const req of plan.required_roles || []) {
    if (req.priority !== "must") continue;
    const matched = all.filter((it) => it.role === req.role);
    if (matched.length === 0) continue;
    const allPlaceholder = matched.every((it) => it.citationQuality === "placeholder");
    if (allPlaceholder) offenders.push(`${req.role}(${matched.length} placeholder)`);
  }
  return {
    id: "NO_PLACEHOLDER_AS_PRIMARY",
    passed: offenders.length === 0,
    detail: offenders.length === 0 ? "no must-role filled only by placeholders" : offenders.join(" ; "),
  };
}

// ---------- Aggregator ----------

export function runAllAssertions({ answerBody, footnotes, metadata, fixtureCounts, assertRoleTelemetry }) {
  const list = [
    assertCountTotal(footnotes, fixtureCounts?.total_footnotes),
    assertAnchored(footnotes, fixtureCounts?.anchored_min_delta),
    assertRerankDrops(metadata),
    assertNoDupStatute(footnotes),
    assertNoTruncation(footnotes),
    assertNoNakedAnaphora(footnotes),
    assertMinTokens(footnotes),
    assertRule37Integrity(answerBody, footnotes),
    assertLegislationNoSupra(answerBody, footnotes),
    assertBodyCoverage(answerBody, footnotes),
  ];
  if (assertRoleTelemetry) {
    list.push(assertRolePlanPresent(metadata));
    list.push(assertRoleGateEvaluated(metadata));
    list.push(assertNoPlaceholderAsPrimary(metadata));
  }
  return list;
}
