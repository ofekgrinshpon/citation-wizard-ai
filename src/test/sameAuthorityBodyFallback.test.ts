import { describe, expect, it } from "vitest";
import {
  collectExistingAlternates,
  docketOfText,
  isFetchableAlternateUrl,
  runSameAuthorityBodyFallback,
  SAME_AUTHORITY_FALLBACK_LIMITS,
  selectEligibleAuthorities,
} from "../../supabase/functions/legal-research-v1/stages/sameAuthorityBodyFallback.ts";

type Input = Parameters<typeof runSameAuthorityBodyFallback>[0];
type AnyCandidate = Input["candidates"][number];

const TITLE = `בג"צ 1000/92 בבלי נ' בית הדין הרבני הגדול`;

function cand(over: Record<string, unknown> = {}): AnyCandidate {
  return {
    candidate_id: "pref",
    title: TITLE,
    snippet: "",
    source_url: "https://supremedecisions.court.gov.il/Home/Download?path=92-1000.pdf",
    source_type: "court_case",
    role: "binding_case_law",
    origin: "web",
    metadata: { source_integrity: { citable_as: "judgment", integrity_flags: [] } },
    ...over,
  } as unknown as AnyCandidate;
}

/** A realistic judgment body: docket + parties + panel + holding language. */
function judgmentBody(): string {
  const head =
    `בבית המשפט העליון בשבתו כבית דין גבוה לצדק\nבג"ץ 1000/92\nחוה בבלי נ' בית הדין הרבני הגדול\n` +
    `לפני: כב' הנשיא מ' שמגר, כב' השופט א' ברק, כב' השופט ד' לוין\nפסק דין\n`;
  return head + "הלכת השיתוף חלה על בני זוג ובית הדין הרבני חייב לפסוק לפיה. ".repeat(200);
}

const failed = [{ normalized_docket: "bagatz:1000/92", status: "canonical_fetch_failed" }];

function baseInput(over: Partial<Input> = {}): Input {
  return {
    candidates: [cand()],
    failed_body_dockets: failed,
    fetchBody: () => Promise.resolve({ text: judgmentBody() }),
    ...over,
  } as Input;
}

describe("same_authority_body_fallback_v1 — eligibility", () => {
  it("A. no fallback when the official body already succeeded", () => {
    const c = cand({
      metadata: {
        source_integrity: { citable_as: "judgment" },
        judgment_text_acquired: true,
        extended_text: judgmentBody(),
      },
    });
    expect(selectEligibleAuthorities({ candidates: [c], failed_body_dockets: failed } as Input))
      .toHaveLength(0);
  });

  it("is inert when no preferred body attempt failed", () => {
    expect(selectEligibleAuthorities({ candidates: [cand()], failed_body_dockets: [] } as Input))
      .toHaveLength(0);
  });

  it("selects the authority when its preferred representation has no body", () => {
    const e = selectEligibleAuthorities(baseInput());
    expect(e).toHaveLength(1);
    expect(e[0].normalized_docket).toBe("bagatz:1000/92");
  });
});

describe("same_authority_body_fallback_v1 — same-authority matching", () => {
  it("B. finds an existing alternate of the same docket and ranks it", () => {
    const alts = collectExistingAlternates(docketOfText(TITLE)!, "pref", baseInput({
      dropped: [{ title: TITLE, url: "https://www.daat.ac.il/daat/psk/bavli-1000-92.htm" }],
    }));
    expect(alts).toHaveLength(1);
    expect(alts[0].origin).toBe("dropped_candidate");
    expect(alts[0].signals.join()).toContain("exact_docket_in_title");
  });

  it("F. rejects a different authority with a similar subject", () => {
    const alts = collectExistingAlternates(docketOfText(TITLE)!, "pref", baseInput({
      dropped: [{
        title: `בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול`,
        url: "https://www.daat.ac.il/x/amir.htm",
      }],
    }));
    expect(alts).toHaveLength(0);
  });

  it("leaves court hosts and paywalls out of this lane", () => {
    expect(isFetchableAlternateUrl("https://supremedecisions.court.gov.il/a.pdf")).toBe(false);
    expect(isFetchableAlternateUrl("https://www.daat.ac.il/a.htm")).toBe(true);
  });
});

describe("same_authority_body_fallback_v1 — acquisition", () => {
  it("B. uses an existing alternate, validates identity, marks primary_mirror", async () => {
    const c = cand();
    const r = await runSameAuthorityBodyFallback(baseInput({
      candidates: [c],
      dropped: [{ title: TITLE, url: "https://www.daat.ac.il/daat/psk/bavli-1000-92.htm" }],
    }));
    const row = r.authority_body_fallback[0];
    expect(row.selected_existing_alternate).toContain("daat.ac.il");
    expect(row.recovery_lookup_attempted).toBe(false);
    expect(row.identity_validated).toBe(true);
    expect(row.body_acquired).toBe(true);
    expect(row.final_representation).toBe("judgment/primary_mirror");
    expect((c.metadata as Record<string, unknown>).judgment_text_acquired).toBe(true);
  });

  it("C+E. one recovery lookup when nothing exists, genuine mirror is accepted", async () => {
    let calls = 0;
    const r = await runSameAuthorityBodyFallback(baseInput({
      recoveryLookup: () => {
        calls++;
        return Promise.resolve({
          query: `בג"ץ 1000/92 בבלי פסק דין`,
          urls: [{ url: "https://www.daat.ac.il/daat/psk/bavli-1000-92.htm", title: TITLE }],
        });
      },
    }));
    expect(calls).toBe(1);
    const row = r.authority_body_fallback[0];
    expect(row.recovery_lookup_attempted).toBe(true);
    expect(row.selected_recovery_url).toContain("daat.ac.il");
    expect(row.identity_validated).toBe(true);
    expect(row.final_representation).toBe("judgment/primary_mirror");
  });

  it("D. commentary merely mentioning the docket cannot become a judgment", async () => {
    const c = cand();
    const r = await runSameAuthorityBodyFallback(baseInput({
      candidates: [c],
      dropped: [{ title: TITLE, url: "https://www.daat.ac.il/daat/psk/bavli-1000-92.htm" }],
      fetchBody: () =>
        Promise.resolve({
          text: `מאמר על הלכת השיתוף. הכותב מזכיר את פסק הדין בעניין בבלי. `.repeat(80),
        }),
    }));
    const row = r.authority_body_fallback[0];
    expect(row.body_acquired).toBe(false);
    expect(row.final_representation).toBeNull();
    expect((c.metadata as Record<string, unknown>).judgment_text_acquired).toBeUndefined();
  });

  it("G. never exceeds the bounded recovery budget", async () => {
    let calls = 0;
    const mk = (id: string, title: string) => cand({ candidate_id: id, title });
    const r = await runSameAuthorityBodyFallback(baseInput({
      candidates: [
        mk("a", `בג"צ 1000/92 בבלי נ' בית הדין הרבני הגדול`),
        mk("b", `בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול`),
        mk("c", `בג"ץ 3914/92 לב נ' בית הדין הרבני האזורי`),
      ],
      failed_body_dockets: [
        { normalized_docket: "bagatz:1000/92", status: "canonical_fetch_failed" },
        { normalized_docket: "bagatz:8638/03", status: "canonical_fetch_failed" },
        { normalized_docket: "bagatz:3914/92", status: "canonical_fetch_failed" },
      ],
      recoveryLookup: () => {
        calls++;
        return Promise.resolve({ query: "q", urls: [] });
      },
    }));
    expect(r.attempted_authorities).toBeLessThanOrEqual(
      SAME_AUTHORITY_FALLBACK_LIMITS.MAX_AUTHORITIES,
    );
    expect(calls).toBeLessThanOrEqual(SAME_AUTHORITY_FALLBACK_LIMITS.MAX_AUTHORITIES);
    expect(r.recovery_lookups_used).toBe(calls);
  });
});
