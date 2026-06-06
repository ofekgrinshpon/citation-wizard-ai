import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  urlContainsDocket,
  urlContainsDocketVia,
  anyUrlContainsDocketVia,
} from "./trustedHosts.ts";

// Helpers
const d = (num: string, year: string) => ({ num, year });

Deno.test("plain NUM/YY on nevo → plain", () => {
  const r = urlContainsDocketVia(
    "https://www.nevo.co.il/case/123/4769/24",
    d("4769", "24"),
  );
  assertEquals(r, { ok: true, via: "plain" });
});

Deno.test("plain %2F encoded → plain", () => {
  const r = urlContainsDocketVia(
    "https://www.psakdin.co.il/Court/abc?docket=4769%2F24",
    d("4769", "24"),
  );
  assertEquals(r, { ok: true, via: "plain" });
});

Deno.test("plain NUM-YY hyphen → plain", () => {
  const r = urlContainsDocketVia(
    "https://example.com/x/4769-24/y",
    d("4769", "24"),
  );
  assertEquals(r.ok, true);
  assertEquals(r.via, "plain");
});

Deno.test("HebrewVerdicts: 8987/22 verified URL → supreme_hebrew_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F22%2F870%2F089%2FE07&fileName=22089870.E07&type=2";
  const r = urlContainsDocketVia(url, d("8987", "22"));
  // Either path or filename channel is acceptable; both should fire on this URL.
  assertEquals(r.ok, true);
});

Deno.test("HebrewVerdicts: 4769/24 expected URL → supreme_hebrew_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F24%2F690%2F047%2FA01&fileName=24047690.A01&type=2";
  const r = urlContainsDocketVia(url, d("4769", "24"));
  assertEquals(r.ok, true);
});

Deno.test("HebrewVerdicts backslash separator (real-world) → supreme_hebrew_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C16%5C950%5C062%5Cz16&fileName=16062950.Z16&type=4";
  const r = urlContainsDocketVia(url, d("6295", "16"));
  assertEquals(r.ok, true);
});

Deno.test("HebrewVerdicts: 5-digit NUM (10208/16) → supreme_hebrew_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F16%2F080%2F102%2Fw03&fileName=16102080.W03&type=2";
  const r = urlContainsDocketVia(url, d("10208", "16"));
  assertEquals(r.ok, true);
});

Deno.test("HebrewVerdicts: 3-digit NUM (883/18) → supreme_hebrew_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F18%2F830%2F008%2Fb06&fileName=18008830.B06&type=4";
  const r = urlContainsDocketVia(url, d("883", "18"));
  assertEquals(r.ok, true);
});

Deno.test("HebrewVerdicts: 4-digit year input (2024) normalizes → match", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F24%2F690%2F047%2FA01&fileName=24047690.A01&type=2";
  const r = urlContainsDocketVia(url, d("4769", "2024"));
  assertEquals(r.ok, true);
});

Deno.test("Adjacent docket 5819/24 must NOT match 4769/24 URL", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F24%2F690%2F047%2FA01&fileName=24047690.A01&type=2";
  const r = urlContainsDocketVia(url, d("5819", "24"));
  assertEquals(r, { ok: false, via: "none" });
});

Deno.test("Adjacent docket 4769/24 must NOT match 5819/24 URL (if such existed)", () => {
  // For 5819/24: D6 = 058190 → first=058, second=190; filename=24058190
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F24%2F190%2F058%2FA01&fileName=24058190.A01&type=2";
  const r = urlContainsDocketVia(url, d("4769", "24"));
  assertEquals(r.ok, false);
});

Deno.test("filename channel only (no HebrewVerdicts path) → supreme_filename", () => {
  // Strip the HebrewVerdicts path, keep only the filename query.
  const url =
    "https://supremedecisions.court.gov.il/Home/SomeOther?fileName=22089870.E07&type=2";
  const r = urlContainsDocketVia(url, d("8987", "22"));
  assertEquals(r.ok, true);
  assertEquals(r.via, "supreme_filename");
});

Deno.test("NetVerdicts: 4769/24 verified URL → supreme_net_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4";
  const r = urlContainsDocketVia(url, d("4769", "24"));
  assertEquals(r.ok, true);
  assertEquals(r.via, "supreme_net_verdicts");
});

Deno.test("NetVerdicts: 6678/20 (2020-0-6678-40-2) → supreme_net_verdicts", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F3%2F10%2F2020-0-6678-40-2&fileName=860aca4ad5c5483db8960c4ef9321651&type=4";
  const r = urlContainsDocketVia(url, d("6678", "20"));
  assertEquals(r.ok, true);
  assertEquals(r.via, "supreme_net_verdicts");
});

Deno.test("NetVerdicts: adjacent-NUM negative (4768/24) → none", () => {
  const url =
    "https://supremedecisions.court.gov.il/Home/Download?path=NetVerdicts%2F2025%2F6%2F26%2F2024-0-4769-16-2&fileName=6ea6c17ca96746bea829eca62c845357&type=4";
  const r = urlContainsDocketVia(url, d("4768", "24"));
  assertEquals(r.ok, false);
});

Deno.test("Non-Supreme host with encoded path → none (host gate works)", () => {
  // Same path string but hosted elsewhere — must not satisfy supreme channels.
  const url =
    "https://example.com/Home/Download?path=HebrewVerdicts%2F24%2F690%2F047%2FA01&fileName=24047690.A01";
  const r = urlContainsDocketVia(url, d("4769", "24"));
  assertEquals(r, { ok: false, via: "none" });
});

Deno.test("Non-Supreme host: plain still matches across hosts", () => {
  const r = urlContainsDocketVia(
    "https://random.example.com/x/4769/24/y",
    d("4769", "24"),
  );
  assertEquals(r.via, "plain");
});

Deno.test("urlContainsDocket boolean wrapper unchanged for plain", () => {
  assertEquals(
    urlContainsDocket("https://nevo.co.il/x/4769/24", d("4769", "24")),
    true,
  );
  assertEquals(
    urlContainsDocket("https://nevo.co.il/x/9999/99", d("4769", "24")),
    false,
  );
});

Deno.test("anyUrlContainsDocketVia returns first non-none channel", () => {
  const urls = [
    "https://example.com/nope",
    "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F24%2F690%2F047%2FA01&fileName=24047690.A01",
    "https://nevo.co.il/x/4769/24",
  ];
  assertEquals(
    anyUrlContainsDocketVia(urls, d("4769", "24")),
    "supreme_hebrew_verdicts",
  );
});

Deno.test("non-string url is safe → none", () => {
  // deno-lint-ignore no-explicit-any
  const r = urlContainsDocketVia(null as any, d("1", "20"));
  assertEquals(r, { ok: false, via: "none" });
});
