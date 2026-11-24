const MAX_BYTES = 16_384;
const MAX_WINDOW_MS = 15 * 60_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_FUTURE_MS = 30_000;
const HEADER_MAX = 128;
const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const marker = /^[A-Za-z0-9_-]{8,32}$/;
const ref = /^[A-Za-z0-9_-]{1,128}$/;
const encoder = new TextEncoder();
const wrappers = new Set(["data", "payload", "order", "transaction", "result"]);
const demandFields = new Set(["orderuniqid","uniqid","paymentrequestuniqid","demanduniqid","paymentrequestid"]);
const orderFields = new Set(["orderid","ordernumber","paymentrequestnumber"]);
const referenceFields = new Set(["orderreference","orderref","externalid","customerreference"]);
const amountFields = new Set(["amount","sum","total","totalamount","dealamount","transactionamount","ordertotalsum"]);
const currencyFields = new Set(["currency","coin","currencycode"]);
const txFields = new Set(["transactionid","transactioninternalnumber","transactionnumber","dealid"]);
const receiptFields = new Set(["documentid","invoiceid","receiptid","documentnumber","invoicenumber","receiptnumber"]);
const statusFields = new Set(["status","statuscode","transactionstatus","orderstatus","responsecode"]);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
type Arm = { start: number; end: number; run: string; demand?: string; order?: string; orderRef?: string; customerTestRef?: string; customerTestAmountMinor?: 100 | 3900; observeExternalCustomerId?: true };
type Deps = { config: () => string | undefined; key: () => string | undefined; log: (safeLine: string) => void;
  now?: () => number; readTimeoutMs?: number };
const approvedConfigKeys = new Set(["start","end","run","demand","order","orderRef","customerTestRef","customerTestAmountMinor","observeExternalCustomerId"]);
function instant(x: unknown): number {
  if (typeof x !== "string" || !utc.test(x)) return NaN;
  const n = Date.parse(x);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,19) === x.slice(0,19) ? n : NaN;
}
function getArm(raw: unknown, now: number): Arm | null {
  if (typeof raw !== "string" || raw.length===0 || raw.length>768) return null;
  const val: unknown=JSON.parse(raw);
  if (!isObj(val) || Object.keys(val).some((k)=>!approvedConfigKeys.has(k))) return null;
  const { run, demand, order, orderRef, customerTestRef, customerTestAmountMinor, observeExternalCustomerId } = val;
  const start=instant(val.start),end=instant(val.end);
  if (!(Number.isFinite(now) && now>=start && now<end && end-start<=MAX_WINDOW_MS)) return null;
  if (typeof run!=="string" || !marker.test(run)) return null;
  if (demand!==undefined && (typeof demand!=="string" || !uuid.test(demand))) return null;
  if (order!==undefined && (typeof order!=="string" || !/^\d{1,16}$/.test(order))) return null;
  if (orderRef!==undefined && (typeof orderRef!=="string" || !ref.test(orderRef))) return null;
  if (customerTestRef!==undefined && (typeof customerTestRef!=="string" || !/^rlx_[0-9a-f]{32}$/.test(customerTestRef))) return null;
  // A strict single-lane diagnostic: other IDs cannot satisfy this test.
  if (customerTestRef && (demand || order || orderRef)) return null;
  if (observeExternalCustomerId!==undefined && (observeExternalCustomerId!==true || !customerTestRef)) return null;
  if (customerTestAmountMinor!==undefined && (!customerTestRef || (customerTestAmountMinor!==100 && customerTestAmountMinor!==3900))) return null;
  if (!demand && !order && !orderRef && !customerTestRef) return null;
  return { start,end,run,demand:demand?.toLowerCase(),order,orderRef,customerTestRef,customerTestAmountMinor,observeExternalCustomerId };
}
function parseSignature(header: string | null) {
  if (!header || header.length>HEADER_MAX) return null;
  const m = /^t=([0-9]{10}),[ \t]*v1=([a-f0-9]{64})$/.exec(header);
  if (!m) return null;
  const sig = new Uint8Array(32);
  for (let i=0;i<sig.length;i++) sig[i] = Number.parseInt(m[2].slice(2*i,2*i+2),16);
  return { t: m[1], time: Number(m[1])*1000, sig };
}
const fresh = (signedAt: number, now: number, arm: Arm) => Number.isFinite(now) && now>=arm.start && now<arm.end &&
  signedAt>=arm.start-MAX_FUTURE_MS && now-signedAt<=MAX_AGE_MS && signedAt-now<=MAX_FUTURE_MS;

async function boundedBytes(req: Request, timeoutMs: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const len=req.headers.get("content-length");
  if ((len!==null && (!/^\d{1,6}$/.test(len) || Number(len)>MAX_BYTES)) || !req.body) return null;
  const reader=req.body.getReader();
  const chunks: Uint8Array[]=[];
  let n=0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout=new Promise<null>((resolve)=>{timer=setTimeout(()=>resolve(null),timeoutMs);});
  try {
    while (true) {
      const step=await Promise.race([reader.read(),timeout]);
      if (step===null) { void reader.cancel().catch(()=>{}); return null; }
      if (step.done) break;
      n+=step.value.length;
      if (n>MAX_BYTES) { void reader.cancel().catch(()=>{}); return null; }
      chunks.push(step.value);
    }
    if (n===0 || (len!==null && n!==Number(len))) return null;
    const out=new Uint8Array(n);
    let offset=0;
    for (const chunk of chunks) {out.set(chunk,offset);offset+=chunk.length;}
    return out;
  } finally {if (timer!==undefined) clearTimeout(timer);}
}

function project(payload: unknown, arm: Arm) {
  if (!isObj(payload)) return { kind: "invalid_body" } as const;
  let fields=0, amounts=0, currencies=0, differentAmount=false, differentCurrency=false;
  const expectedAmountMinor=arm.customerTestAmountMinor??100;
  let cidSeen=false, cidMatched=false, cidDifferent=false;
  const result={ demandMatched:false, orderMatched:false, referenceMatched:false, hasTransaction:false, hasReceipt:false, hasStatus:false, hasAction:false };
  function walk(obj: Record<string, unknown>, allowWrappers: boolean) {
    for (const [k,v] of Object.entries(obj)) {
      if (++fields>200) return;
      const name=k.length<=64?k.toLowerCase().replace(/[ _-]/g,""):"";
      if (allowWrappers && wrappers.has(name) && isObj(v)) {walk(v,false);continue;}
      const str=typeof v==="string"?v:typeof v==="number" && Number.isSafeInteger(v)?String(v):null;
      if (arm.customerTestRef && k==="c_id") {
        cidSeen=true;
        if (v===arm.customerTestRef) cidMatched=true; else cidDifferent=true;
      }
      if (demandFields.has(name) && str && uuid.test(str) && str.toLowerCase()===arm.demand) result.demandMatched=true;
      if (orderFields.has(name) && str && str===arm.order) result.orderMatched=true;
      if (referenceFields.has(name) && str && str===arm.orderRef) result.referenceMatched=true;
      if (amountFields.has(name)) {
        amounts++;
        const expectedWhole=String(expectedAmountMinor/100);
        if (!(v===expectedAmountMinor/100 || (typeof v==="string" &&
          (v===expectedWhole || v===expectedWhole+".0" || v===expectedWhole+".00")))) differentAmount=true;
      }
      if (currencyFields.has(name)) {
        currencies++;
        if (!(str && ["ils","nis","376"].includes(str.toLowerCase()))) differentCurrency=true;
      }
      if (txFields.has(name) && str && ref.test(str)) result.hasTransaction=true;
      if (receiptFields.has(name) && str && ref.test(str)) result.hasReceipt=true;
      if (name==="action" && str && ref.test(str)) result.hasAction=true;
      if (statusFields.has(name) && str && /^[+-]?\d{1,6}$/.test(str)) result.hasStatus=true;
    }
  }
  walk(payload,true);
  if (fields>200) return { kind: "invalid_body" } as const;
  if (arm.customerTestRef) {
    if (!cidSeen) return { kind: "hosted_cid_absent" } as const;
    if (!cidMatched || cidDifferent) return { kind: "hosted_cid_mismatch" } as const;
    if (amounts===0 || differentAmount || differentCurrency) return { kind: "hosted_amount_not_confirmed" } as const;
    return { kind: "projected", value: {...result,hostedCidMatched:true,amount:"expected",
      currency:currencies===0?"absent":"expected"} } as const;
  }
  if (!(result.demandMatched || result.orderMatched || result.referenceMatched))
    return { kind: "order_mismatch" } as const;
  return { kind: "projected", value: {...result,amount:amounts===0?"absent":differentAmount?"other":"expected",
    currency:currencies===0?"absent":differentCurrency?"other":"expected"} } as const;
}
// Exact candidate shapes only. Presence/equality is diagnostic, not a verified
// order/reference, settled payment, or entitlement. Never emit the field value.
function externalCustomerObservation(payload: unknown, expected: string) {
  if (!isObj(payload)) return null;
  const own=(v:unknown,k:string)=>isObj(v) && Object.hasOwn(v,k);
  const order=own(payload,"order")?payload.order:null;
  const scopes=[payload,order].filter(isObj);
  const paths:unknown[]=[];
  const hasFlat=own(payload,"ExternalCustomerId");
  if(hasFlat) paths.push(payload.ExternalCustomerId);
  let ambiguous=hasFlat && Object.keys(payload).filter(k=>k.toLowerCase()==="externalcustomerid").length>1;
  for(const scope of scopes) {
    const customers=Object.keys(scope).filter(k=>k.toLowerCase()==="customer");
    if(customers.length>1) ambiguous=true;
    for (const [customerKey,externalKey] of [["Customer","ExternalCustomerId"],["customer","externalCustomerId"]]) {
      if(!own(scope,customerKey)) continue;
      const customer=scope[customerKey];
      if(!isObj(customer)) continue;
      if(Object.keys(customer).filter(k=>k.toLowerCase()==="externalcustomerid").length>1) ambiguous=true;
      if(own(customer,externalKey)) paths.push(customer[externalKey]);
    }
  }
  const hasOld=own(payload,"c_id") || scopes.some(o=>own(o,"c_id")) ||
    ["data","payload","order","transaction","result"].some(k=>own(payload,k)&&own(payload[k],"c_id"));
  if(ambiguous || paths.length>1) return hasOld?"external_ambiguous_with_cid":"external_ambiguous";
  if(!paths.length) return hasOld?"external_missing_with_cid":"external_missing";
  if(hasFlat) {
    if(paths[0]!==expected) return hasOld?"external_flat_unrelated_with_cid":"external_flat_unrelated";
    return hasOld?"external_flat_matching_with_cid":"external_flat_matching";
  }
  if(paths[0]!==expected) return hasOld?"external_unrelated_with_cid":"external_unrelated";
  return hasOld?"external_matching_with_cid":"external_matching";
}
const reply = (status: number) => new Response(null,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
/** Diagnostic only. No database, authorization grants, external calls or raw logs. */
export function createTakbullSignedProofObserver(deps: Deps) {
  // Suppress retries for the configured proof in this warm instance. Not an
  // exactly-once guarantee across replicas; logs are observation, not a ledger.
  let observedRun = "";
  type RejectReason = "signature_missing" | "signature_malformed" | "timestamp" | "key_unusable"
    | "signature_mismatch" | "invalid_body" | "order_mismatch" | "unsupported_media"
    | "hosted_cid_absent" | "hosted_cid_mismatch" | "hosted_amount_not_confirmed"
    | "external_ambiguous" | "external_ambiguous_with_cid"
    | "external_missing" | "external_missing_with_cid"
    | "external_unrelated" | "external_unrelated_with_cid"
    | "external_matching" | "external_matching_with_cid"
    | "external_flat_unrelated" | "external_flat_unrelated_with_cid"
    | "external_flat_matching" | "external_flat_matching_with_cid";
  let diagnosticArm = "";
  const emitted = new Set<RejectReason>();
  const diagnose = (arm: Arm, reason: RejectReason) => {
    const id = arm.start+"-"+arm.end+"-"+arm.run;
    if (diagnosticArm !== id) { diagnosticArm = id; emitted.clear(); }
    if (emitted.has(reason)) return;
    emitted.add(reason);
    try { deps.log(JSON.stringify({ marker: "TAKBULL_SIGNED_DIAG_V1", run: arm.run, reason })); }
    catch { /* best effort only; never alter public responses */ }
  };
  return async (req: Request): Promise<Response> => {
    // Temporary test route: GET answers empty 200 before clock, config, body or
    // secret reads, and logs nothing. POST verification below is unchanged.
    if (req.method === "GET") return reply(200);
    const now=deps.now??Date.now;
    try {
      const arm=getArm(deps.config(),now());
      if (!arm) return reply(404);
      if (req.method!=="POST") return reply(405);
      const reject = (status: number, reason: RejectReason) => {
        try { const t=now(); if (Number.isFinite(t) && t>=arm.start && t<arm.end) diagnose(arm, reason); } catch { /* diagnostic only */ }
        return reply(status);
      };
      if (req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")
        return reject(415,"unsupported_media");
      const contentEncoding=req.headers.get("content-encoding");
      if (contentEncoding!==null && contentEncoding.toLowerCase()!=="identity")
        return reject(415,"unsupported_media");
      const header=req.headers.get("x-takbull-signature");
      const entry=parseSignature(header);
      let key: string | undefined;
      try { key=deps.key(); }
      catch { return reject(401,"key_unusable"); }
      if (!entry) return reject(401,header===null?"signature_missing":"signature_malformed");
      if (!fresh(entry.time,now(),arm)) return reject(401,"timestamp");
      if (typeof key!=="string" || key.length<16 || key.length>256) return reject(401,"key_unusable");
      let body: Awaited<ReturnType<typeof boundedBytes>>;
      try { body=await boundedBytes(req,deps.readTimeoutMs??2500); }
      catch { return reject(401,"invalid_body"); }
      if (!body) return reject(401,"invalid_body");
      if (!fresh(entry.time,now(),arm)) return reject(401,"timestamp");
      const prefix=encoder.encode(entry.t+".");
      const bytes=new Uint8Array(prefix.length+body.length);
      bytes.set(prefix); bytes.set(body,prefix.length);
      let imported: CryptoKey;
      try { imported=await crypto.subtle.importKey("raw",encoder.encode(key),{name:"HMAC",hash:"SHA-256"},false,["verify"]); }
      catch { return reject(401,"key_unusable"); }
      if (!(await crypto.subtle.verify("HMAC",imported,entry.sig,bytes))) return reject(401,"signature_mismatch");
      if (!fresh(entry.time,now(),arm)) return reject(401,"timestamp");
      // Verify bytes before decoding; no normalization, reserialization or body logging.
      let parsed: unknown;
      try { parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(body)); }
      catch { return reject(401,"invalid_body"); }
      const projection=project(parsed,arm);
      if (arm.observeExternalCustomerId && arm.customerTestRef && projection.kind!=="invalid_body") {
        try {
          const observation=externalCustomerObservation(parsed,arm.customerTestRef);
          const t=now();
          if (observation && Number.isFinite(t) && t>=arm.start && t<arm.end) diagnose(arm,observation);
        } catch { /* diagnostic only; never affect response */ }
      }
      if (projection.kind!=="projected") return reject(401,projection.kind);
      const projected=projection.value;
      if (observedRun!==arm.run) {
        deps.log(JSON.stringify({marker:"TAKBULL_SIGNED_PROOF_V1",run:arm.run,
          authenticated:true,...projected}));
        observedRun=arm.run;
      }
      return reply(204);
    } catch { return reply(401); }
  };
}
