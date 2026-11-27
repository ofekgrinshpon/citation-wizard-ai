/** Exact NZ Supreme Court identity only; this module does not infer reporter or styling. */
const NZSC = /^(?:\[(20\d{2})\]|(20\d{2}))\s+NZSC\s+([1-9]\d{0,3})$/iu;

export function parseNzscNumber(input: string) {
  const m = NZSC.exec(input.trim());
  if (!m) return null;
  const year = m[1] ?? m[2];
  const number = m[3];
  if (Number(year) < 2004) return null;
  return { neutral: `[${year}] NZSC ${number}`, year, number };
}

export function nzscJudgmentUrl(input: string): string | null {
  const id = parseNzscNumber(input);
  return id ? `https://www.courtsofnz.govt.nz/assets/cases/${id.year}/${id.year}-NZSC-${id.number}.pdf` : null;
}

export function parseNzscCover(input: string, url: string, cover: string) {
  const id = parseNzscNumber(input);
  if (!id || url !== nzscJudgmentUrl(input)) return null;
  const lines = cover.split(/\r?\n/).slice(0, 40).map(line => line.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (lines[0] !== "IN THE SUPREME COURT OF NEW ZEALAND") return null;
  const captionStart = lines.findIndex(line => line.startsWith("BETWEEN "));
  if (captionStart < 3 || captionStart > 8) return null;
  const courtHeader = lines.slice(1, captionStart);
  const numbers = courtHeader.filter(line => /^\[\d{4}\] NZSC \d+$/.test(line));
  const dockets = courtHeader.filter(line => /^SC \d+\/\d{4}$/.test(line));
  if (numbers.length !== 1 || numbers[0] !== id.neutral || dockets.length !== 1) return null;
  const parties = /^BETWEEN (.{1,190}?) (?:Appellant|Applicant) AND (.{1,190}?) (?:First Respondent|Respondent)(?: |$)/
    .exec(lines.slice(captionStart, captionStart + 14).join(" "));
  if (!parties || ![parties[1], parties[2]].every(party => /\p{L}/u.test(party))) return null;
  return { neutral: id.neutral, docket: dockets[0], firstParty: parties[1], secondParty: parties[2], url };
}
