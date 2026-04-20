

## Goal
Stop charging credits in the **אזכור אחיד** (single citation / freetext) flow when the input is gibberish/invalid, and refund automatically if the assistant returns a "cannot interpret" refusal anyway. Scope is limited to this flow — no pricing, plans, or other product areas change.

## Where the bug lives today
- `src/pages/Index.tsx` → `handleSend()` calls `callAPI()` → `supabase.functions.invoke("citation-chat")` for every freetext submit, regardless of input quality.
- `supabase/functions/citation-chat/index.ts` (~line 708) calls `consume_credits` **before** generating the answer. The only auto-refund path today is the outer `catch` (line 1482) for thrown exceptions. A polite Hebrew refusal from the model returns 200 OK and the credit stays burned.
- `useCredits.consume` / `refund_credits` RPC + `handleRefundResponse` helper already exist and are idempotent — we just need to wire them.

## Plan

### 1. New shared validator: `src/lib/citationInputValidation.ts`
Pure function, no deps, reusable:
```ts
validateCitationInput(text: string):
  { valid: true } | { valid: false; reason: string; messageHe: string }
```
Heuristics (all cheap, deterministic):
- trim → reject if empty.
- reject if length < 6 chars **and** no legal pattern (see allow-list).
- reject single-char repetition (e.g. `עעעע`, `aaaa`, `1111`) — `/^(.)\1{2,}$/` after stripping spaces.
- reject random Latin/digit-only strings ≥ 4 chars with no Hebrew (`asdf`, `123123`, `qweqwe`).
- reject if no Hebrew letters AND no recognized legal token AND no URL.
- **Allow-list overrides** (return valid even if short): matches any of —
  - legal abbreviation regex (`בג"ץ|ע"א|ע"פ|רע"א|דנ"א|ת"א|ע"ע|עע"מ|בש"פ|ת"פ|תפ"ח|עמ"ה|בר"ם` etc., reusing the same list already in `citation-chat`),
  - `חוק|פקודת|פקודה|תקנות|צו|חוק[- ]יסוד|סעיף|הצעת חוק|אמנה|תקנון`,
  - case number pattern `\d+\/\d+`,
  - a URL,
  - `נ'` / `נגד` party separator,
  - quoted title `"..."` with ≥ 2 Hebrew words inside.
- Also a "≥ 2 distinct meaningful tokens (≥ 2 chars each)" gate as a generic catch-all when no allow-list pattern matched.

Return Hebrew message:
- `messageHe: "לא ניתן לעבד את הבקשה כי לא זוהה טקסט משפטי ברור לאזכור."`
- secondary line handled by the caller toast: `"לא בוצע חיוב בקרדיטים."`

Add a small refusal detector in the same file:
```ts
isRefusalResponse(text: string): boolean
```
Matches the canonical refusal phrases the AI returns:
- `העוזר המשפטי האוטומטי אינו יכול לפרש`
- `לא ניתן לפרש את הבקשה`
- `לא נמצא טקסט משפטי`
- `הקלט אינו ברור`
- `cannot interpret` / `unable to interpret` (defensive English)
- response that is < 20 chars OR has zero of `{חוק, סעיף, ע"א, ת"א, פ"ד, ס"ח, ק"ת, https?://, נ'}` markers AND contains an apology/refusal token (`אינו|לא ניתן|לא נמצא|מצטער`).

### 2. Client-side gate in `src/pages/Index.tsx` → `handleSend`
Insert **before** any state mutation / network call:
```ts
const v = validateCitationInput(rawText);
if (!v.valid) {
  toast.error(v.messageHe, { description: "לא בוצע חיוב בקרדיטים." });
  return;
}
```
Place it right after `if (!rawText || loading) return;` and before `subscription.isLimitReached` / `normalizeAbbreviations`. No credit consumption can happen before this gate because charging lives inside the edge function. Apply only inside `handleSend` (the freetext path) — `handleBillTypeSelect`, `handleTreatyTypeSelect`, `handleSuggestionAccept`, `BatchFootnoteBuilder`, `BibliographyGenerator`, and `LegalQAChat` are untouched.

### 3. Server-side fallback in `supabase/functions/citation-chat/index.ts`

Two changes:

**a. Pre-consume validation (mirror of client gate).** Right after `creditRequestId` is set and `userInput` is extracted (~line 635), reuse the same heuristics inline (the edge function can't import from `src/`, so duplicate the small validator into a constant block at the top of `index.ts` — ~25 lines). If invalid, return 400 with a structured payload **before** calling `consume_credits`:
```ts
return new Response(JSON.stringify({
  error: "INVALID_INPUT",
  messageHe: "לא ניתן לעבד את הבקשה כי לא זוהה טקסט משפטי ברור לאזכור.",
}), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
```

**b. Post-response refund.** Right before the final `return new Response(JSON.stringify({ content: ... }))` (success path), run `isRefusalResponse(content)`. If true:
```ts
await refundIfCharged("invalid_input_refusal");
return new Response(JSON.stringify({
  content,
  refunded: true,
  refundReason: "הקלט לא היה ברור דיו לעיבוד",
}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
```
`refund_credits` is already idempotent server-side, so re-runs are safe.

### 4. Client handles new responses

In `Index.tsx` → `callAPI` (line 190–212) and the `handleSend` try-block:
- If `data?.error === "INVALID_INPUT"` → toast `data.messageHe` + "לא בוצע חיוב בקרדיטים.", **don't** push an assistant bubble, **don't** increment counters; throw a sentinel handled silently.
- If `data?.refunded === true` → reuse the existing `handleRefundResponse(data)` helper from `src/lib/refundResponse.ts` (already shows "הוחזרו אוטומטית" toast). Still display the assistant content so the user sees the refusal explanation, but skip `subscription.incrementCount()` and skip writing to `verified_sources`.

### 5. No DB migration, no plan changes, no edge-function config changes
`refund_credits` and `consume_credits` RPCs already exist with idempotency. `supabase/config.toml` is untouched. No new secrets.

## Files to change
- **NEW** `src/lib/citationInputValidation.ts` — validator + refusal detector (shared).
- `src/pages/Index.tsx` — pre-validate in `handleSend`; handle `INVALID_INPUT` and `refunded: true` responses; suppress counter on those branches.
- `supabase/functions/citation-chat/index.ts` — duplicate validator (Deno can't import from `src/`); add pre-consume 400 short-circuit; add post-response refusal detection + auto-refund.

## Out of scope
- Other modes (Legal QA, Batch, Bibliography, Manual Entry, document grounding).
- Pricing tiers, plan logic, top-up flow, referral flow.
- `useSubscription.incrementCount` (legacy lifetime counter — left alone).

## Expected outcome
- Typing `עעעע`, `asdf`, `123`, `   `, or empty input → instant Hebrew toast, **zero network call**, **zero credit consumed**.
- If a malformed input slips past the heuristic and the model returns a refusal, the credit is automatically refunded, the user sees `"הפעולה לא הושלמה והקרדיט הוחזר אוטומטית"` toast, and the refund appears in their `credit_ledger` history.
- Valid citations (`חוק העונשין סעיף 34כב`, `ע"א 248/86 …`, `Atkins v. Virginia`, etc.) behave exactly as today — 1 credit charged, citation produced.

