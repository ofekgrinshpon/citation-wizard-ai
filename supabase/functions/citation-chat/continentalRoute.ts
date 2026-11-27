import { boeArticleUrl, boeArticleVersion, continentalCaseDate, continentalCaseUrl, germanDecisionApiUrl, germanDecisionRecord, germanSectionTitle, type ContinentalId } from "../_shared/citationPure/continentalEvidence.ts";
import { chargePageFetch, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";
import { readBoundedBody } from "../_shared/pdfExtractionProtocol.ts";
import { STC_GAZETTE_LOCATORS } from "./spanishGazetteLocators.ts";
import { BGB_SNAPSHOT_DATE, BGB_TITLES } from "./germanBgbTitles.ts";

const DAY = 86_400_000;
export async function lookupGermanBgb(id: ContinentalId, budget: CitationBudget, fetchImpl: typeof fetch, now = Date.now()) {
  if (id.template !== "de.statute.bgb" || !id.section || !id.direct || !chargePageFetch(budget)) return null;
  const age = now - Date.parse(BGB_SNAPSHOT_DATE);
  const snapshot = BGB_TITLES[id.section];
  const fallback = () => snapshot && age >= 0 && age <= 45 * DAY
    ? {field:"title",value:snapshot,url:id.direct!,sourceTitle:`BGB official XML snapshot ${BGB_SNAPSHOT_DATE}`}
    : null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetchImpl(id.direct,{redirect:"manual",signal:ctrl.signal,headers:{Accept:"text/html"}});
    if (r.redirected || (r.url && r.url !== id.direct) || !r.ok ||
        !/^text\/html(?:;|$)/i.test(r.headers.get("content-type") ?? "")) {
      void r.body?.cancel().catch(() => {});
      return !r.redirected && (!r.url || r.url === id.direct) && r.status >= 500 && r.status <= 599 ? fallback() : null;
    }
    const bytes = await readBoundedBody(r.body,256_000,ctrl.signal);
    // The official page declares ISO-8859-1. Decode bytes directly rather
    // than making server success depend on an optional codec implementation.
    let html = "";
    for (let i=0;i<bytes.length;i+=4096) html += String.fromCharCode(...bytes.subarray(i,i+4096));
    const value = germanSectionTitle(id,html);
    return value && !/weggefallen|aufgehoben/i.test(value) ? {field:"title",value,url:id.direct} : null;
  } catch (error) {
    // A destination/network error is not evidence that the section disappeared.
    // Never substitute the snapshot for contradictory HTML or official 4xx.
    return ctrl.signal.aborted || error instanceof TypeError ? fallback() : null;
  } finally { clearTimeout(timer); }
}


/** Stop at the court's metadata boundary; the judgment body can be several MB. */
async function readSpanishDecisionHeader(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<string> {
  if (!body || signal.aborted) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8",{fatal:true});
  const boundary = /<div\s+id="complete_resolucion"[^>]*>/;
  let count = 0;
  let html = "";
  let onAbort!: () => void;
  const aborted = new Promise<{done:true; value:undefined}>(resolve => {
    onAbort = () => resolve({done:true,value:undefined});
    signal.addEventListener("abort",onAbort,{once:true});
  });
  try {
    while (!signal.aborted && count < 65_536) {
      const {value,done} = await Promise.race([reader.read(),aborted]);
      if (done || signal.aborted) break;
      const part = value.subarray(0,65_536-count);
      count += part.byteLength;
      html += decoder.decode(part,{stream:true});
      const end = boundary.exec(html);
      if (end) return html.slice(0,end.index);
    }
    return "";
  } finally {
    signal.removeEventListener("abort",onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The official form has four fixed steps. This terminal route alone may use
 * four sequential HTTP requests, with no retry, provider search or model fallback. */
async function lookupSpanishCourt(id: ContinentalId, budget: CitationBudget, fetchImpl: typeof fetch) {
  if (budget.unknown || budget.retrievals || budget.searches || budget.modelCalls) return null;
  const court = "https://hj.tribunalconstitucional.es";
  const csrfName = "__RequestVerificationToken_L0hK0";
  const sessionName = "ASP.NET_SessionId";
  const ctrl = new AbortController();
  const indexedLocator = STC_GAZETTE_LOCATORS[id.key];
  const timer = setTimeout(() => ctrl.abort(), indexedLocator ? 12_000 : 16_000);
  const request = async (url: string, init: RequestInit = {}) => {
    if (ctrl.signal.aborted || budget.unknown || budget.retrievals >= 4) throw new Error("court_lookup_budget");
    budget.retrievals++;
    const res = await fetchImpl(url, { ...init, redirect:"manual", signal:ctrl.signal,
      headers:{ Accept:"text/html", ...init.headers } });
    if (res.redirected || (res.url && res.url !== url)) {
      void res.body?.cancel().catch(() => {});
      throw new Error("unexpected_court_url");
    }
    return res;
  };
  const html = async (res: Response, headerOnly = false) => {
    if (res.status !== 200 || !/^text\/html(?:;|$)/i.test(res.headers.get("content-type") ?? "")) {
      void res.body?.cancel().catch(() => {});
      return "";
    }
    return headerOnly ? await readSpanishDecisionHeader(res.body,ctrl.signal)
      : new TextDecoder("utf-8",{fatal:true}).decode(await readBoundedBody(res.body,256_000,ctrl.signal));
  };
  // Some fetch implementations combine Set-Cookie values. Select only the
  // named, ordinary form cookies; reject conflicting session IDs.
  const cookie = (res: Response, name: string) => {
    const entries = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const pairs = entries.flatMap(line => line.split(/,\s*(?=[^;,= ]+=)/)).map(line => line.split(";",1)[0].trim());
    const matching = [...new Set(pairs.filter(pair => pair.startsWith(name+"=")))];
    return matching.length === 1 && /^[A-Za-z0-9_-]{1,512}$/.test(matching[0].slice(name.length+1)) ? matching[0] : null;
  };
  const verifyOwnRecord = async (url: string) => {
    const value = continentalCaseDate(id,await html(await request(url),true));
    return value ? {field:"decisionDate",value,url} : null;
  };
  try {
    if (indexedLocator) {
      const directUrl = continentalCaseUrl(id,court + "/es/Resolucion/Show/" + indexedLocator);
      return directUrl ? await verifyOwnRecord(directUrl) : null;
    }
    const [number,year] = id.key.slice(4).split("/");
    const form = await request(court + "/es");
    const csrf = cookie(form,csrfName);
    const forms = [...(await html(form)).matchAll(/<input name="__RequestVerificationToken" type="hidden" value="([A-Za-z0-9_-]{1,512})"\s*\/>/g)];
    if (!csrf || forms.length !== 1) return null;
    const post = await request(court + "/es/Busqueda/Buscar",{
      method:"POST",headers:{Cookie:csrf,"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({ TIPO_RESOLUCION:"SENTENCIA", NUMERO_RESOLUCION:number, ANNO_RESOLUCION:year,
        __RequestVerificationToken:forms[0][1] }),
    });
    void post.body?.cancel().catch(() => {});
    const session = cookie(post,sessionName);
    if (post.status !== 302 || post.headers.get("location") !== "/es/Resolucion/List" || !session) return null;
    const list = await html(await request(court + "/es/Resolucion/List",{headers:{Cookie:session}}));
    const lists = [...list.matchAll(/<ul id="resolution-list">([\s\S]*?)<\/ul>/g)];
    if (lists.length !== 1) return null;
    const labels = [...lists[0][1].matchAll(/<a class="resolucion-item" href="([^"]+)">([^<]+)<\/a>/g)];
    const exact = new RegExp(`^(?:Pleno|Sala Primera|Sala Segunda|Sección (?:Primera|Segunda|Tercera|Cuarta))\\. SENTENCIA ${number}/${year}, de\\b`);
    const hits = labels.filter(([, , label]) => exact.test(label.trim()));
    if (hits.length !== 1 || !/^\/es\/Resolucion\/Show\/[1-9]\d{0,6}$/.test(hits[0][1])) return null;
    const url = continentalCaseUrl(id,court + hits[0][1]);
    return url ? await verifyOwnRecord(url) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function lookupContinental(id: ContinentalId, budget: CitationBudget, fetchImpl: typeof fetch) {
  if (id.template === "es.case.stc") return await lookupSpanishCourt(id, budget, fetchImpl);
  if (id.template === "de.statute.bgb") return await lookupGermanBgb(id,budget,fetchImpl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  const fetchText = async (url: string, type: "html" | "xml" | "json", encoding = "utf-8") => {
    if (ctrl.signal.aborted || !chargePageFetch(budget)) return "";
    const r = await fetchImpl(url,{redirect:"error",signal:ctrl.signal,headers:{Accept:type === "xml" ? "application/xml" : type === "json" ? "application/json" : "text/html"}});
    const mime = r.headers.get("content-type") ?? "";
    if (!r.ok || r.redirected || (r.url && r.url !== url) ||
        !(type === "xml" ? /^(application|text)\/xml(?:;|$)/i : type === "json" ? /^application\/json(?:;|$)/i : /^text\/html(?:;|$)/i).test(mime)) {
      void r.body?.cancel().catch(() => {});
      return "";
    }
    return new TextDecoder(encoding,{fatal:true}).decode(await readBoundedBody(r.body,900_000,ctrl.signal));
  };
  try {
    if (id.template === "de.case.bverfg") {
      const record = germanDecisionRecord(id, await fetchText(germanDecisionApiUrl(id),"json"));
      return record ? {field:"decisionDate",...record} : null;
    }
    const url = boeArticleUrl(id);
    if (!url) return null;
    const value = boeArticleVersion(id, await fetchText(url,"xml"));
    return value ? {field:"date",value,url} : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
