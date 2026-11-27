// Narrow reader for the court's observed Decisia iframe markup. Parent wrappers
// and body-text mentions are not usable as decision evidence.
export const ONCA_ID = /^(20\d{2})\s+ONCA\s+([1-9]\d{0,3})$/;
export function ontarioRecordUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.host !== 'coadecisions.ontariocourts.ca' || u.username || u.password ||
        !/^\/coa\/coa\/en\/item\/[1-9]\d{0,8}\/index\.do$/.test(u.pathname) ||
        (u.search && u.search !== '?iframe=true')) return null;
    return u.origin + u.pathname + '?iframe=true';
  } catch { return null; }
}

const entities: Record<string,string> = {"&amp;":"&","&nbsp;":" ","&quot;":'"',"&apos;":"'","&#39;":"'"};
const plain = (s: string) => s.replace(/<[^>]*>/g,' ').replace(/&(?:amp|nbsp|quot|apos|#39);/g, e => entities[e])
  .replace(/\s+/g,' ').trim();

export function readOntarioDecision(requested: string, finalURL: string, html: string) {
  const mId = ONCA_ID.exec(requested);
  if (!mId || ontarioRecordUrl(finalURL) !== finalURL || html.length > 512_000) return null;
  const id = {year:mId[1],identifier:`${mId[1]} ONCA ${mId[2]}`};
  const m=/<div class="metadata">\s*<h3 class="title">([^<]+)<\/h3>\s*<table>([\s\S]{1,10000}?)<\/table>/.exec(html);
  if (!m) return null;
  const rows=[...m[2].matchAll(/<td class="label">([^<]+)<\/td>\s*<td class="metadata">\s*([^<]+?)\s*(?:<\/td>\s*)?<\/tr>/g)];
  const one=(key: string)=>{const values=rows.filter((r)=>r[1]===key);return values.length===1?plain(values[0][2]):null;};
  const caption=plain(m[1]), date=one('Date');
  if (!caption || caption.length>240 || one('Collection')!=='Decisions of the Court of Appeal'||
      one('Neutral citation')!==id.identifier|| !/^\d{4}-\d{2}-\d{2}$/.test(date??'')||
      date?.slice(0,4)!==id.year) return null;
  const heading=/<div id="document-content">\s*<div class="documentcontent">\s*<div class="WordSection1">\s*<p[^>]*>([^<]+)<\/p>\s*<p class="CITATION">([\s\S]{1,700}?)<\/p>/.exec(html);
  if (!heading || plain(heading[1])!=='COURT OF APPEAL FOR ONTARIO'||
      plain(heading[2])!=='CITATION: '+caption+', '+id.identifier) return null;
  return {caption, identifier:id.identifier, date};
}
