import { supabase } from "@/integrations/supabase/client";

const GOOGLE_REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
export const normalizeGoogleReferralCode = (value: string | null) => {
  const code = value?.toUpperCase() ?? "";
  return GOOGLE_REFERRAL_CODE.test(code) ? code : null;
};
export const GOOGLE_REFERRAL_STORAGE_KEY = "relex_google_referral_intent";
const TTL_MS = 15 * 60 * 1000;
const RPC_TIMEOUT_MS = 2400;
const CLAIM_TIMEOUT_MS = 4800;
type RpcResult = { data: unknown; error: unknown };
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
type Intent = { token: string; savedAt: number; referralCode: string; boundAccountId?: string };
export type GoogleReferralOutcome = "linked" | "not-linked" | "unverified";
const pending = new Map<string, Promise<GoogleReferralOutcome>>();
const invoke = (name: string, args?: Record<string, unknown>) =>
  Promise.resolve().then(() => (supabase.rpc as unknown as Rpc).call(supabase, name, args));

function bounded<T>(work: PromiseLike<T>, timeoutMs = RPC_TIMEOUT_MS): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    Promise.resolve(work).then(
      value => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
const asPayload = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;
const validToken = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 16 && value.length <= 4096 && !/\s/.test(value);

export async function isGoogleReferralEnabled() {
  const result = await bounded(invoke("get_google_referral_enabled"));
  return !!result && !result.error && result.data === true;
}

export function clearGoogleReferralIntent(expectedToken?: string) {
  try {
    if (!expectedToken || asPayload(JSON.parse(sessionStorage.getItem(GOOGLE_REFERRAL_STORAGE_KEY) ?? "null"))?.token === expectedToken) {
      sessionStorage.removeItem(GOOGLE_REFERRAL_STORAGE_KEY);
    }
  } catch { /* No storage means no persisted intent. */ }
}

export function clearStoredReferralCode() {
  try { sessionStorage.removeItem("relex_ref_code"); } catch { /* Degraded storage. */ }
}

export function readGoogleReferralIntent(): Intent | null {
  try {
    const text = sessionStorage.getItem(GOOGLE_REFERRAL_STORAGE_KEY);
    if (!text) return null;
    const value = asPayload(JSON.parse(text));
    if (!value || !validToken(value.token) || typeof value.savedAt !== "number" ||
        typeof value.referralCode !== "string" || !normalizeGoogleReferralCode(value.referralCode)) return null;
    const age = Date.now() - value.savedAt;
    if (!Number.isFinite(age) || age < 0 || age >= TTL_MS) return null;
    return { token: value.token, savedAt: value.savedAt, referralCode: value.referralCode,
      boundAccountId: typeof value.boundAccountId === "string" ? value.boundAccountId : undefined };
  } catch { return null; }
}

/** Only called on explicit invited Google registration, before opening OAuth. */
export async function prepareGoogleReferralIntent(code: string | null) {
  clearGoogleReferralIntent();
  if (!code || !GOOGLE_REFERRAL_CODE.test(code)) return false;
  const result = await bounded(invoke("begin_google_referral_intent", { _referral_code: code }));
  const data = asPayload(result?.data);
  if (!result || result.error || data?.ok !== true || !validToken(data.token)) return false;
  try {
    const intent: Intent = { token: data.token, savedAt: Date.now(), referralCode: code };
    sessionStorage.setItem(GOOGLE_REFERRAL_STORAGE_KEY, JSON.stringify(intent));
    return readGoogleReferralIntent()?.token === intent.token;
  } catch { return false; }
}

function bindIntentToAccount(token: string, accountId: string) {
  const intent = readGoogleReferralIntent();
  if (!intent || intent.token !== token || (intent.boundAccountId && intent.boundAccountId !== accountId)) return false;
  try {
    if (!intent.boundAccountId) sessionStorage.setItem(GOOGLE_REFERRAL_STORAGE_KEY, JSON.stringify({ ...intent, boundAccountId: accountId }));
    return true;
  } catch { return false; }
}

/** Claims only to the current authenticated Google account; server revalidates eligibility. */
export function claimGoogleReferralIntent(token: string, accountId: string): Promise<GoogleReferralOutcome> {
  const key = `${accountId}:${token}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = (async (): Promise<GoogleReferralOutcome> => {
    const deadline = Date.now() + CLAIM_TIMEOUT_MS;
    const timeLeft = () => Math.max(0, Math.min(RPC_TIMEOUT_MS, deadline - Date.now()));
    if (!bindIntentToAccount(token, accountId)) return "not-linked";
    // One repeat is safe: the RPC treats the same intent and same account idempotently.
    for (let i = 0; i < 2 && timeLeft() > 0; i++) {
      const auth = await bounded(Promise.resolve().then(() => supabase.auth.getSession()), timeLeft());
      const user = auth?.data.session?.user;
      if (user?.id !== accountId || user?.app_metadata?.provider !== "google" || readGoogleReferralIntent()?.token !== token || timeLeft() <= 0) return "unverified";
      const result = await bounded(invoke("claim_google_referral_intent", { _token: token }), timeLeft());
      if (result && !result.error) {
        const data = asPayload(result.data);
        if (data?.ok === true && (data.claimed === true || data.replayed === true)) return "linked";
        if (typeof data?.ok === "boolean") return "not-linked";
      }
    }
    return "unverified";
  })();
  pending.set(key, promise);
  void promise.then(() => pending.delete(key), () => pending.delete(key));
  return promise;
}
