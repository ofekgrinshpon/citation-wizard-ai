const root = "https://judgments.courts.ie";
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const plain = (s: string) => norm(s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " "));

export function parseIesc(input: string) {
  const m = /^(?:\[(20\d{2})\]|(20\d{2}))\s+IESC\s+([1-9]\d{0,3})$/i.exec(input.trim());
  return m ? `[${m[1] ?? m[2]}] IESC ${m[3]}` : null;
}
export function searchUrl(input: string) {
  const neutral = parseIesc(input);
  return neutral ? `${root}/judgments?${new URLSearchParams({courtIds:"15",judge:"",neutralCitation:neutral,q:"",sort:"",type:"Judgment",year:""})}` : null;
}
export function findExactRecord(input: string, html: string) {
  const neutral = parseIesc(input);
  if (!neutral || html.length > 800_000 || !/<ul\b[^>]*\bid="judgments-list"/i.test(html)) return null;
  const rows = [...html.matchAll(/<li\b[^>]*\bclass="card"[^>]*>([\s\S]*?)<\/li>/gi)];
  const matches = new Map<string, string>();
  for (const [,row] of rows) {
    const id = /Neutral citation:\s*<\/span>\s*([^<]+)<\/span>/i.exec(row);
    const link = /<a class="card-title" href="\/judgments\/([1-9]\d{0,8})(?:\?[^"]*)?">([\s\S]*?)<\/a>/i.exec(row);
    if (!id || plain(id[1]) !== neutral || !link ||
        !/Court:\s*<\/span>\s*Supreme Court\s*<\/span>/i.test(row) ||
        !/courts-result-card__type"[^>]*>\s*Judgment\s*<\/span>/i.test(row)) continue;
    const caption = plain(link[2]);
    if (!caption || caption.length > 350) continue;
    if (matches.has(link[1]) && matches.get(link[1]) !== caption) return null;
    matches.set(link[1],caption);
  }
  if (matches.size !== 1) return null;
  const [[id,caption]] = matches;
  return { neutral, caption, url:`${root}/judgments/${id}` };
}

export function iescRecordUrl(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\/judgments\.courts\.ie\/judgments\/[1-9]\d{0,8}$/.test(url) ? url : null;
}

/** Both the official result and official record must agree on their own identity. */
export function confirmIescRecord(record: NonNullable<ReturnType<typeof findExactRecord>>, html: string) {
  if (!iescRecordUrl(record.url) || html.length > 400_000) return null;
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => plain(m[1]));
  const fields = [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)];
  const get = (key: string) => fields.filter(m => plain(m[1]) === key).map(m => plain(m[2]));
  if (headings.length !== 1 || headings[0] !== record.caption ||
      get("Neutral citation").join(";") !== record.neutral || get("Court").join(";") !== "Supreme Court") return null;
  return { ...record, caption: record.caption.replace(/\s+-v-\s+/gi, " v ") };
}
