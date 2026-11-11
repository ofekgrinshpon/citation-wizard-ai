/**
 * Canonical ONE-TIME citation pass catalogue, shared by the site and the
 * server. Prices, currency and source counts are authoritative only when read
 * on the server from this module; client input never supplies them.
 * These ids are NOT legacy PLANS values, provider product ids, or entitlements.
 * No subscription and no automatic renewal exist for these offers.
 */
export type CitationPassTerm =
  | { readonly unit: "day"; readonly count: 7 }
  | { readonly unit: "calendar_month"; readonly count: 1 };

export interface CitationPassOffer {
  readonly id: "citation_week_pass_v1" | "citation_month_pass_v1";
  readonly priceIls: number;
  readonly currency: "ILS";
  readonly sourceCount: number;
  readonly term: CitationPassTerm;
  readonly billing: "one_time";
  readonly autoRenew: false;
}

export const CITATION_PASS_OFFERS: readonly CitationPassOffer[] = Object.freeze([
  Object.freeze({ id: "citation_week_pass_v1", priceIls: 39, currency: "ILS", sourceCount: 100,
    term: Object.freeze({ unit: "day", count: 7 }), billing: "one_time", autoRenew: false }),
  Object.freeze({ id: "citation_month_pass_v1", priceIls: 65, currency: "ILS", sourceCount: 250,
    term: Object.freeze({ unit: "calendar_month", count: 1 }), billing: "one_time", autoRenew: false }),
] as const);

export type CitationPassOfferId = CitationPassOffer["id"];

/** Exact, case-sensitive allowlist lookup. Anything else is unknown. */
export function findCitationPassOffer(id: unknown): CitationPassOffer | null {
  if (typeof id !== "string") return null;
  return CITATION_PASS_OFFERS.find((o) => o.id === id) ?? null;
}
