export type ContinentalId = { jurisdiction: "DE" | "ES"; kind: "case" | "statute";
  template: "de.case.bverfg" | "de.statute.bgb" | "es.case.stc" | "es.statute.constitution";
  key: string; direct?: string; section?: string; paragraph?: string; asOf?: string };

export const BOE_CONSTITUTION = "BOE-A-1978-31229";
export const BOE_TEXT = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/" + BOE_CONSTITUTION + "/texto";
const bgb = "https://www.gesetze-im-internet.de/bgb/";
const ES_HJ = "https://hj.tribunalconstitucional.es";
const DE_NEURIS = "https://testphase.rechtsinformationen.bund.de";
export function realDate(date: string) {
  const t = new Date(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(+t) && t.toISOString().slice(0, 10) === date;
}
export function parseContinental(raw: string): ContinentalId | null {
  const s = raw.trim();
  let m = /^(?:§\s*([1-9]\d{0,3}[a-z]?)\s+BGB|BGB\s+§\s*([1-9]\d{0,3}[a-z]?))$/.exec(s);
  if (m) {
    const section = m[1] ?? m[2];
    return {jurisdiction:"DE",kind:"statute",template:"de.statute.bgb",key:`BGB § ${section}`,section,direct:`${bgb}__${section}.html`};
  }
  m = /^(?:Constitución Española|BOE-A-1978-31229),?\s+art\.\s*([1-9]\d{0,2})(?:\(([1-9]\d?)\))?\s+as of (\d{4}-\d{2}-\d{2})$/iu.exec(s);
  if (m && realDate(m[3])) {
    const [,section,paragraph,asOf] = m;
    return {jurisdiction:"ES",kind:"statute",template:"es.statute.constitution",key:`BOE-A-1978-31229 art. ${section}${paragraph ? `(${paragraph})` : ""} as of ${asOf}`,section,paragraph,asOf};
  }
  m = /^STC ([1-9]\d{0,3})\/((?:19|20)\d{2})$/.exec(s);
  if (m) return {jurisdiction:"ES",kind:"case",template:"es.case.stc",key:`STC ${m[1]}/${m[2]}`};
  m = /^ECLI:DE:BVerfG:((?:19|20)\d{2}):((?:rs|rk)\d{8}\.[12]bvr\d{3,8})$/.exec(s);
  if (m && m[1] === m[2].slice(2,6)) return {jurisdiction:"DE",kind:"case",template:"de.case.bverfg",key:s};
  return null;
}
const textOf = (s: string) => s.replace(/<[^>]*>/g," ").replace(/(?:&#167;|&sect;)/gi,"§").replace(/(?:&#160;|&nbsp;)/gi," ").replace(/\s+/g," ").trim();
export function continentalCaseUrl(id: ContinentalId, rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password || u.hash || u.search) return null;
    if (id.template === "es.case.stc" && u.origin === ES_HJ) {
      const locator = /^\/(?:HJ\/)?[a-z]{2,3}(?:-[a-z]{2})?\/Resolucion\/Show\/([1-9]\d{0,6})$/i.exec(u.pathname);
      return locator ? `${ES_HJ}/es-ES/Resolucion/Show/${locator[1]}` : null;
    }
    if (id.template === "de.case.bverfg" && u.origin === DE_NEURIS && /^\/gerichtsentscheidungen\/KVRE\d{9}$/.test(u.pathname)) return u.href + "?view=details";
  } catch { /* not a trusted locator */ }
  return null;
}
export function germanDecisionApiUrl(id: ContinentalId): string {
  return DE_NEURIS + "/v1/rechtsprechung?" + new URLSearchParams({ecli:id.key,size:"2"});
}

export function germanDecisionRecord(id: ContinentalId, json: string): {value:string;url:string} | null {
  if (id.template !== "de.case.bverfg") return null;
  const collection = JSON.parse(json);
  if (collection?.["@type"] !== "hydra:Collection" || collection.totalItems !== 1 ||
      !Array.isArray(collection.member) || collection.member.length !== 1 || collection.view?.next !== null) return null;
  const [hit] = collection.member;
  const item = hit?.item;
  if (hit?.["@type"] !== "SearchResult" || item?.["@type"] !== "Decision" ||
      item.courtType !== "BVerfG" || item.ecli !== id.key ||
      typeof item.documentNumber !== "string" || !/^KVRE\d{9}$/.test(item.documentNumber) ||
      item["@id"] !== `/v1/rechtsprechung/${item.documentNumber}` ||
      typeof item.decisionDate !== "string" || !realDate(item.decisionDate) ||
      id.key.split(":")[4].slice(2,10) !== item.decisionDate.replace(/-/g,"")) return null;
  return {value:item.decisionDate,url:`${DE_NEURIS}/gerichtsentscheidungen/${item.documentNumber}?view=details`};
}

export function continentalCaseDate(id: ContinentalId, html: string): string | null {
  if (id.template === "es.case.stc") {
    const headings = [...html.matchAll(/<li id="resolucion-identifier">\s*<h2>\s*SENTENCIA (\d+)\/(\d{4}), de (\d{1,2}) de (\w+)/g)];
    const [h] = headings;
    if (headings.length !== 1) return null;
    const e = [...html.matchAll(/<label class="ecli">([^<]+)<\/label>/g)];
    if (!h || id.key !== `STC ${h[1]}/${h[2]}` || e.length !== 1 || e[0][1] !== `ECLI:ES:TC:${h[2]}:${h[1]}`) return null;
    const month = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(" ").indexOf(h[4]) + 1;
    const date = `${h[2]}-${String(month).padStart(2,"0")}-${h[3].padStart(2,"0")}`;
    return realDate(date) ? date : null;
  }
  return null;
}
export function germanSectionTitle(id: ContinentalId, html: string): string | null {
  const t = /<title>([^<]+)<\/title>/.exec(html);
  const h = /Bürgerliches Gesetzbuch \(BGB\)<br\s*\/?>\s*<span class="jnenbez">([^<]+)<\/span>(?:\s|&#160;|&nbsp;)*<span class="jnentitel">([^<]+)<\/span>/.exec(html);
  const key = `§ ${id.section}`;
  return t && h && textOf(t[1]) === `${key} BGB - Einzelnorm` && textOf(h[1]) === key ? textOf(h[2]) : null;
}
const xmlOk = (s: string) => /^\s*(?:<\?xml[^?]*\?>\s*)?<response>\s*<status>\s*<code>200<\/code>[\s\S]*?<\/status>\s*<data>/.test(s) && !/<!DOCTYPE|<!ENTITY/i.test(s);
export function boeArticleUrl(id: ContinentalId): string | null {
  if (id.template !== "es.statute.constitution" || !id.section || !/^[1-9]\d{0,2}$/.test(id.section)) return null;
  return Number(id.section) <= 169 ? `${BOE_TEXT}/bloque/a${id.section}` : null;
}
export function boeArticleVersion(id: ContinentalId, xml: string): string | null {
  if (!xmlOk(xml) || !id.asOf || !id.section) return null;
  const block = /<data>\s*<bloque id="([^"]+)" tipo="precepto" titulo="([^"]+)">([\s\S]+?)<\/bloque>\s*<\/data>/.exec(xml);
  if (!block || block[1] !== `a${id.section}` || block[2] !== `Artículo ${id.section}`) return null;
  const versions = [...block[3].matchAll(/<version id_norma="(BOE-A-\d{4}-\d+)" fecha_publicacion="\d{8}" fecha_vigencia="(\d{4})(\d{2})(\d{2})">([\s\S]+?)<\/version>/g)];
  if (!versions.length || versions[0][1] !== BOE_CONSTITUTION || (block[3].match(/<version\b/g) ?? []).length !== versions.length) return null;
  const dates = versions.map(([, ,year,month,day]) => `${year}-${month}-${day}`);
  if (dates.some((d,i) => !realDate(d) || (i > 0 && dates[i-1] >= d))) return null;
  const i = dates.filter(d => d <= id.asOf!).length - 1;
  if (i < 0) return null;
  const content = versions[i][5];
  const ownHeading = /<p class="articulo">([^<]+)<\/p>/.exec(content);
  const paragraphs = [...content.matchAll(/<p class="parrafo">([\s\S]*?)<\/p>/g)].map(p=>textOf(p[1])).filter(Boolean);
  if (ownHeading?.[1] !== `Artículo ${id.section}` || !paragraphs.length ||
      paragraphs.every(p => /^[(\[]?(?:derogad[oa]|suprimid[oa])\b/i.test(p)) ||
      (id.paragraph && !paragraphs.some(p => p.startsWith(id.paragraph + ". ")))) return null;
  return dates[i];
}
