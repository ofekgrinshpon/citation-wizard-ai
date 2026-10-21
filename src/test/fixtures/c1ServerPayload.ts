/** Produce existing wire envelopes with the production extractor, mocked fetch only. */
import { runForeignLookup, type ForeignLookupInput } from "../../../supabase/functions/citation-chat/foreignLookup";
import { resolveStatuteLookup } from "../../../supabase/functions/citation-chat/statuteRoute";
export const C1_BROWN = { title: "Brown v. Board of Education, 347 U.S. 483 (1954)", url: "https://www.courtlistener.com/opinion/105221/brown-v-board-of-education/", snippet: "Brown v. Board of Education, 347 U.S. 483 (1954)." };
export const C1_REDIGI = { title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)", url: "https://www.courtlistener.com/opinion/4500000/capitol-records-llc-v-redigi-inc/", snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)." };
export async function c1ServerPayload(input: ForeignLookupInput, results = [C1_BROWN]) {
  const calls: string[] = [];
  const fetchImpl = (async (address: string | URL | Request) => {
    calls.push(String(address));
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
  const response = input.kind === "statute"
    ? await resolveStatuteLookup({ enabled: true, statuteResponseVersion: 1, ...input }, { fetchImpl, apiKey: "offline-only", runLookup: runForeignLookup })
    : await runForeignLookup(input, { fetchImpl, apiKey: "offline-only" });
  return { response, calls };
}