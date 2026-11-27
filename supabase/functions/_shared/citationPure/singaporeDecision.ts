const host = "https://www.elitigation.sg";
const plain = (s: string) => s.replace(/<[^>]*>/g," ").replace(/&nbsp;|\u00a0/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
export function parseSingapore(input: string) {
  const m=/^(?:\[(20\d{2})\]|(20\d{2}))\s+(SGCA|SGHC)\s+(\d{1,4})$/i.exec(input.trim());
  if (!m) return null;
  const year = m[1] ?? m[2], court = m[3].toUpperCase() as "SGCA" | "SGHC", number = String(Number(m[4]));
  if (number === "0" || (m[4] !== number && (court !== "SGHC" || Number(year) >= 2021))) return null;
  const templateId = court === "SGHC" ? "sg.case.sghc_neutral" : "sg.case.sgca_neutral";
  return {neutral:`[${year}] ${court} ${number}`,url:`${host}/gd/s/${year}_${court}_${number}`, court, year, number, templateId} as const;
}
export function singaporeEvidence(input: string, url: string, html: string) {
  const id=parseSingapore(input);
  if (!id || id.url!==url || html.length>2_500_000) return null;
  const titles=[...html.matchAll(/<title>([^<]+)<\/title>/gi)];
  const archive = id.court === "SGHC" && Number(id.year) < 2021;
  const exact = (text: string) => archive
    ? parseSingapore(plain(text))?.neutral === id.neutral
    : plain(text) === id.neutral;
  if(titles.length!==1 || !exact(titles[0][1])) return null;
  const names=[...html.matchAll(/<div class="HN-CaseName\s[^"]*">([\s\S]{1,1500}?)<div class="(?:HN-NeutralCit|HN-CaseName)\s[^"]*">\s*<span[^>]*>([^<]+)<\/span>\s*<\/div>\s*<div class="HN-Coram\s[^"]*">\s*(Court of Appeal|General Division of the High Court|High Court)\b/g)];
  const heading = archive ? "High Court" : id.court === "SGHC" ? "General Division of the High Court" : "Court of Appeal";
  let sourceCaption: string;
  if (names.length) {
    if (names.length !== 1 || !exact(names[0][2]) || names[0][3] !== heading) return null;
    sourceCaption = names[0][1];
  } else {
    if (!archive) return null;
    // Older official HTML has a case heading and a separate metadata table.
    const candidates = [...html.matchAll(/<h2\b[^>]*class="title"[^>]*>\s*<span class="caseTitle">([\s\S]{1,1500}?)<\/span>\s*<br\s*\/?\s*>\s*<span class="(?:N?Citation) offhyperlink">([^<]+)<\/span>\s*<\/h2>\s*<table id="info-table">([\s\S]{1,12000}?)<\/table>/gi)];
    if (candidates.length !== 1 || !exact(candidates[0][2])) return null;
    const courtRows = [...candidates[0][3].matchAll(/<td\b[^>]*>\s*Tribunal\/Court\s*<\/td>\s*<td\b[^>]*>\s*:\s*<\/td>\s*<td\b[^>]*>\s*(<indexcourt>[^<]+<\/indexcourt>|[^<]+)\s*<\/td>/gi)];
    if (courtRows.length !== 1 || plain(courtRows[0][1]) !== "High Court") return null;
    sourceCaption = candidates[0][1];
  }
  // Preserve inline text joins: the official HTML can split a name across spans.
  const caption=plain(sourceCaption.replace(/<\/?(?:span|b|strong|i|em)\b[^>]*>/gi, ""));
  if(!/^[^<>]{1,180} v [^<>]{1,180}$/.test(caption) || /&(?:#\w+|\w+);/.test(caption)) return null;
  return {...id,caption};
}
