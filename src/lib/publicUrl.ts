/**
 * Canonical public URL for ReLex.
 *
 * Used for:
 *  - shareable referral links (always ReLex-branded, never lovable.app)
 *  - auth email redirects (verification, password reset, magic link)
 *
 * Hard-coded on purpose: when a logged-in user is browsing the staging /
 * preview deployment, we still want every link they share publicly to point
 * to the production marketing domain.
 */
export const PUBLIC_SITE_URL = "https://relexlm.com";

/** Build a referral signup link for the current user's referral code. */
export function buildReferralLink(referralCode: string | null | undefined): string {
  if (!referralCode) return "";
  return `${PUBLIC_SITE_URL}/auth?mode=signup&ref=${referralCode}`;
}

/**
 * Pick the right origin for auth-email redirect URLs (email verification,
 * password reset). On the production domain we keep `window.location.origin`
 * so deep links still work locally; on preview / lovable.app we force the
 * canonical domain so emails never expose Lovable URLs to recipients.
 */
export function getAuthRedirectOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_SITE_URL;
  const host = window.location.hostname;
  // Production hosts — use whatever the user is on (relexlm.com, www.relexlm.com)
  if (host === "relexlm.com" || host === "www.relexlm.com") {
    return window.location.origin;
  }
  // Anything else (lovable preview, localhost) → canonical site
  return PUBLIC_SITE_URL;
}
