import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { matchedDocketIds, textMatchesDockets } from "./attachments.ts";

Deno.test("textMatchesDockets matches Hebrew docket variants", () => {
  const variants = ['בג"ץ 5555/18', "HCJ 5555/18", "5555/18"];
  assertEquals(textMatchesDockets('מהי ההלכה בבג"ץ 5555/18?', variants), true);
  assertEquals(textMatchesDockets("HCJ 5555/18 ruling", variants), true);
  assertEquals(textMatchesDockets('ע"א 1234/22', variants), false);
});

Deno.test("matchedDocketIds returns canonical docket_id slugs", () => {
  const variants = ['בג"ץ 5555/18'];
  assertEquals(matchedDocketIds('בג"ץ 5555/18 עדאלה', variants), ["bagatz-5555-18"]);
  assertEquals(
    matchedDocketIds('ע"א 1234/22 ובג"ץ 5555/18', variants),
    ["aa-1234-22", "bagatz-5555-18"],
  );
});

Deno.test("matchedDocketIds handles English aliases", () => {
  const variants = ["HCJ 5555/18"];
  assertEquals(matchedDocketIds("HCJ 5555/18 ruling", variants), ["bagatz-5555-18"]);
});
