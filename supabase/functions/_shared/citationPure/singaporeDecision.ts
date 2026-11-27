const host = "https://www.elitigation.sg";
const plain = (s: string) => s.replace(/<[^>]*>/g," ").replace(/&nbsp;|\u00a0/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
export function parseSingapore(input: string) {
  const m=/^(?:\[(20\d{2})\]|(20\d{2}))\s+(SGCA|SGHC)\s+([1-9]\d{0,3})$/i.exec(input.trim());
  if (!m) return null;
  const year = m[1] ?? m[2], court = m[3].toUpperCase() as "SGCA" | "SGHC", number = m[4];
  if (court === "SGHC" && Number(year) < 2021) return null;
  const templateId = court === "SGHC" ? "sg.case.sghc_neutral" : "sg.case.sgca_neutral";
  return {neutral:`[${year}] ${court} ${number}`,url:`${host}/gd/s/${year}_${court}_${number}`, court, year, number, templateId} as const;
}
export function singaporeEvidence(input: string, url: string, html: string) {
  const id=parseSingapore(input);
  if (!id || id.url!==url || html.length>2_500_000) return null;
  const titles=[...html.matchAll(/<title>([^<]+)<\/title>/gi)];
  if(titles.length!==1 || plain(titles[0][1])!==id.neutral) return null;
  const names=[...html.matchAll(/<div class="HN-CaseName\s[^"]*">([\s\S]{1,1500}?)<div class="(?:HN-NeutralCit|HN-CaseName)\s[^"]*">\s*<span[^>]*>([^<]+)<\/span>\s*<\/div>\s*<div class="HN-Coram\s[^"]*">\s*(Court of Appeal|General Division of the High Court)\b/g)];
  const heading = id.court === "SGHC" ? "General Division of the High Court" : "Court of Appeal";
  if(names.length!==1 || plain(names[0][2])!==id.neutral || names[0][3]!==heading) return null;
  // Preserve inline text joins: the official HTML can split a name across spans.
  const caption=plain(names[0][1].replace(/<\/?(?:span|b|strong|i|em)\b[^>]*>/gi, ""));
  if(!/^[^<>]{1,180} v [^<>]{1,180}$/.test(caption) || /&(?:#\w+|\w+);/.test(caption)) return null;
  return {...id,caption};
}
