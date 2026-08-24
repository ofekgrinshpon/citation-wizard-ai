// Temporary diagnostic probe for official_court_egress_path_v1. Not part of the product.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { url } = await req.json().catch(() => ({ url: "" }));
  const out: Record<string, unknown> = { url };

  // 1. direct edge fetch
  try {
    const t0 = Date.now();
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept": "application/pdf,text/html,*/*;q=0.8",
        "Accept-Language": "he-IL,he;q=0.9",
        "Referer": "https://supremedecisions.court.gov.il/Home/Search",
      },
    });
    const b = new Uint8Array(await r.arrayBuffer());
    out.direct = { status: r.status, ct: r.headers.get("content-type"), bytes: b.length, ms: Date.now() - t0 };
  } catch (e) {
    out.direct = { error: String(e) };
  }

  // 2. ConvertAPI pdf/to/txt with server-side URL fetch
  try {
    const t0 = Date.now();
    const secret = Deno.env.get("CONVERTAPI_SECRET") ?? "";
    const r = await fetch(`https://v2.convertapi.com/convert/pdf/to/txt?Secret=${secret}&StoreFile=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Parameters: [{ Name: "File", FileValue: { Url: url } }] }),
    });
    const txt = await r.text();
    let chars = 0, sample = "";
    try {
      const j = JSON.parse(txt);
      const d = j?.Files?.[0]?.FileData;
      if (d) {
        const bin = atob(d);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const s = new TextDecoder("utf-8").decode(bytes);
        chars = s.length;
        sample = s.slice(0, 300);
      }
    } catch { /* ignore */ }
    out.convertapi = {
      status: r.status,
      ms: Date.now() - t0,
      chars,
      sample,
      raw: chars ? null : txt.slice(0, 400),
    };
  } catch (e) {
    out.convertapi = { error: String(e) };
  }

  // 3. Apify super-scraper standby
  try {
    const t0 = Date.now();
    const token = Deno.env.get("APIFY_API_TOKEN") ?? "";
    const r = await fetch(
      `https://apify--super-scraper-api.apify.actor/?url=${encodeURIComponent(url)}&token=${token}`,
      { headers: { "User-Agent": UA } },
    );
    const t = await r.text();
    out.apify_standby = { status: r.status, ms: Date.now() - t0, len: t.length, sample: t.slice(0, 300) };
  } catch (e) {
    out.apify_standby = { error: String(e) };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
