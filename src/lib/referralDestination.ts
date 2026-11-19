export const REFERRAL_SIGN_IN = "/auth?mode=login&next=referral";
export const REFERRAL_PROFILE = "/profile?tab=referral";
const KEY = "relex_auth_referral_destination";
const MAX_AGE_MS = 10 * 60 * 1000;

export function isReferralDestination(search: URLSearchParams) {
  return search.get("next") === "referral";
}

export function afterSignIn(isOfficeAddin: boolean, referral: boolean) {
  return isOfficeAddin ? "/app?addin=1" : referral ? REFERRAL_PROFILE : "/app";
}

/** Carry the fixed internal destination through the existing OAuth callback URL. */
export function setOAuthReferralDestination(referral: boolean) {
  try {
    if (referral) sessionStorage.setItem(KEY, String(Date.now()));
    else sessionStorage.removeItem(KEY);
  } catch { /* Storage unavailable: ordinary OAuth navigation still works. */ }
}

export function hasOAuthReferralDestination() {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (!stored) return false;
    const age = Date.now() - Number(stored);
    return Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS;
  } catch { return false; }
}
