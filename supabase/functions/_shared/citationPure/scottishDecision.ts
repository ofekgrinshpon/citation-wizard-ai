/** Narrow Court of Session identity reader. No inferred reporters. */
export const SCOTTISH_ID = /^\[(20\d{2})\][ \t]+(CSIH|CSOH)[ \t]+([1-9]\d{0,3})$/;
export const SCOTTISH_ANCHOR = /^\s*(?:[^\r\n]+?\s+v\.?\s+[^\r\n]+?[, ]\s*)?\[(?:20\d{2})\][ \t]+(?:CSIH|CSOH)\b/;
export const scottishCourt = (court: unknown) => court === "CSIH" || court === "CSOH";
const THIN_SPACES = /[ \t]+/g;
const compact = (s: string) => s.replace(THIN_SPACES, "");
/** Only explicit, bounded paragraph locators. Never infer a page from a bare number. */
export function parseScottishCitation(raw: string) {
  const text = raw.trim().replace(/\.$/, "");
  const bare = SCOTTISH_ID.exec(text);
  const located = !bare && /^(\[20\d{2}\][ \t]+(?:CSIH|CSOH)[ \t]+[1-9]\d{0,3})(?:,?[ \t]+(paragraphs?|paras?\.?)\s+([1-9]\d{0,3})(?:[ \t]*[–-][ \t]*([1-9]\d{0,3}))?)$/i.exec(text);
  const bracketed = !bare && !located && /^(\[20\d{2}\][ \t]+(?:CSIH|CSOH)[ \t]+[1-9]\d{0,3})[ \t]+\[([1-9]\d{0,3})\](?:[ \t]*[–-][ \t]*\[([1-9]\d{0,3})\])?$/.exec(text);
  const neutral = located ? located[1] : bracketed ? bracketed[1] : null;
  const match = bare || (neutral && SCOTTISH_ID.exec(neutral));
  if (!match || Number(match[1]) < 2005) return null;
  const from = located ? Number(located[3]) : bracketed ? Number(bracketed[2]) : null;
  const to = located ? Number(located[4] ?? located[3]) : bracketed ? Number(bracketed[3] ?? bracketed[2]) : null;
  if (from !== null && to !== null && (to < from || to - from > 9 || (located && !/s\.?$/i.test(located[2]) && to !== from))) return null;
  return { year: match[1], court: match[2], number: match[3], id: `[${match[1]}] ${match[2]} ${match[3]}`,
    paragraph: from === null ? null : from === to ? String(from) : `${from}–${to}`, lastParagraph: to };
}

/** Extend a contiguous run of numbered body labels. Mid-line citations and forward jumps cannot count. */
export function advanceScottishParagraphs(page: string, previous: number, target: number) {
  for (const line of page.split(/\r?\n/)) {
    const marker = /^[ \t]*\[[ \t]*([1-9](?:[ \t]*\d){0,3})[ \t]*\][ \t]+\S/.exec(line);
    if (marker && Number(compact(marker[1])) === previous + 1) {
      previous++;
      if (previous >= target) break;
    }
  }
  return previous;
}
export function scottishJudgmentUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ["scotcourts.gov.uk", "www.scotcourts.gov.uk"].includes(u.host) &&
      !u.username && !u.password && !u.search && !u.hash &&
      /^\/media\/[a-z0-9]+\/[a-z0-9-]+\.pdf$/.test(u.pathname) ? u : null;
  } catch { return null; }
}
export function readScottishIdentity(u: URL, raw: string, pageOne: string) {
  const wanted = SCOTTISH_ID.exec(raw.trim());
  if (!wanted || !scottishJudgmentUrl(u.href)) return null;
  const lines = pageOne.slice(0, 3_000).split(/\r?\n/).slice(0, 42).map(s => s.trim()).filter(Boolean);
  const headerEnd = lines.findIndex(s => /^\[\s*1\s*\][ \t]+\S/.test(s));
  const header = headerEnd < 0 ? lines : lines.slice(0, headerEnd);
  const division = header[0]?.match(/^(?:(?:FIRST|SECOND) DIVISION, )?(INNER|OUTER) HOUSE, COURT OF SESSION$/)?.[1];
  const identifier = '[' + wanted[1] + '] ' + wanted[2] + ' ' + wanted[3];
  const filenameId = /^\/media\/[^/]+\/(20\d{2})(csih|csoh)(\d+)(?:[-.]|$)/.exec(u.pathname);
  if (filenameId && '[' + filenameId[1] + '] ' + filenameId[2].toUpperCase() + ' ' + Number(filenameId[3]) !== identifier) return null;
  if (division !== (wanted[2] === "CSIH" ? "INNER" : "OUTER") ||
    compact(header[1] ?? "") !== compact(identifier)) return null;
  const docket = compact(header[2] ?? "");
  if (!/^[A-Z]{1,4}\d+\/\d{2}$/.test(docket) ||
    !header.slice(3, 10).some(line => /^(?:OPINION OF |STATEMENT OF REASONS$)/.test(line))) return null;
  const against = header.findIndex((line, index) => index > 3 && compact(line).toLowerCase() === "against");
  if (against < 5 || !/^Pursuers?(?:and(?:Respondents?|Reclaimers?))?$/i.test(compact(header[against - 1] ?? "")) ||
    !/^Defenders?(?:and(?:Respondents?|Reclaimers?))?$/i.test(compact(header[against + 2] ?? ""))) return null;
  const parties = [header[against - 2], header[against + 1]];
  if (parties.some(s => !s || !/[A-Z]/.test(s) || s !== s.toUpperCase())) return null;
  const dates = header.slice(against + 3).filter(s => /^\d{1,2} [A-Z][a-z]+ 20\d{2}$/.test(s));
  if (dates.length !== 1 || !dates[0].endsWith(wanted[1]) || !Number.isFinite(Date.parse(dates[0]))) return null;
  return { identifier, docket, caption: parties.join(" v "), date: dates[0], sourceUrl: u.href };
}
