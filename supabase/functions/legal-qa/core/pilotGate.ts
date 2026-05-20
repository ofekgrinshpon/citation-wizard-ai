// Research Core v1 — pilot-topic gate.
// While RESEARCH_PIPELINE=core is enabled, only questions matching the three
// approved pilot topics actually enter Core. Everything else falls through to
// the existing V4→V3→V1 chain (unchanged).
const PILOT_PATTERNS: RegExp[] = [
  /צו\s*מניעה\s*זמני/,
  /אי[\s\-]?הפעלת\s*סמכות\s*מנהלית/,
  /(אפרופים|סעיף\s*25\b)/,
];

export function isCorePilot(question: string): boolean {
  if (!question) return false;
  return PILOT_PATTERNS.some((re) => re.test(question));
}

export function corePilotLabel(question: string): string | null {
  if (/צו\s*מניעה\s*זמני/.test(question)) return "P1_temp_injunction";
  if (/אי[\s\-]?הפעלת\s*סמכות\s*מנהלית/.test(question)) return "P2_admin_inaction";
  if (/(אפרופים|סעיף\s*25\b)/.test(question)) return "P3_apropim_s25";
  return null;
}
