# Google Workspace setup on relexlm.com (real inboxes)

## Where the domain is registered

- **Purchased through Lovable** (domain status: `mode: "buy"`, active ~139 days).
- **Underlying DNS host: Name.com** — confirmed by live NS lookup (`ns1.name.com`, `ns2fln.name.com`, …) and SOA (`ns1.name.com`). Google Workspace detected this and offered "automatic verification via Name.com sign-in."
- You do **not** have a direct Name.com account — Lovable holds the registrar/reseller account and you manage DNS through Lovable's UI. So the **automatic Name.com sign-in verification will not work** for you.
- DNS is managed at: **Workspace settings → Workspace domains → Configure → DNS records** (supports A, AAAA, CNAME, **MX**, TXT, SRV, NS).

## Current DNS state (verified live)

```text
relexlm.com          NS  → ns1/ns2/ns3/ns4 .name.com   (Name.com-hosted zone)
relexlm.com          A   → 185.158.133.1                (Lovable site)
relexlm.com          MX  → (none)                       ← safe to add Google MX here
relexlm.com          TXT → (none)                       ← safe to add SPF here
notify.relexlm.com   NS  → ns3/ns4 .lovable.cloud       (Lovable email infra — DO NOT TOUCH)
notify.relexlm.com   MX  → mailgun (Lovable outbound)
```

Because Lovable's outbound email lives on the **delegated subdomain** `notify.relexlm.com`, adding Google's MX/SPF/DKIM to the **root** `relexlm.com` zone does **not conflict** with existing app email. The two zones are independent.

## Goal (per your answers)

Real inboxes only — `support@relexlm.com`, `privacy@relexlm.com` — for receiving mail in Google Workspace. Keep Lovable outbound email on `notify.relexlm.com` exactly as-is. No app code changes needed.

## Plan — all steps done by you in the Lovable DNS manager + Google Workspace admin

### Step 1 — Verify domain ownership (manual TXT)
1. In Google Workspace verification screen, choose **"אפשרויות אימות אחרות"** (other methods) → **"Add a TXT record"** (not the automatic Name.com sign-in).
2. Copy the verification token, e.g. `google-site-verification=…`.
3. In **Workspace settings → Workspace domains → Configure → DNS records**, add:
   - Type: `TXT`
   - Host: `@` (root, i.e. `relexlm.com`)
   - Value: the verification token
   - TTL: default
4. Wait 5–60 min, then click **Verify** in Google Workspace.

### Step 2 — Create the inboxes
In Google Workspace admin, create user accounts (or aliases on your primary account):
- `support@relexlm.com`
- `privacy@relexlm.com`

### Step 3 — Enable incoming mail (Google MX records on root)
In the Lovable DNS manager, add Google's MX records to root `relexlm.com` (Host `@`):
```text
MX  relexlm.com   aspmx.l.google.com       Priority 1
MX  relexlm.com   alt1.aspmx.l.google.com  Priority 5
MX  relexlm.com   alt2.aspmx.l.google.com  Priority 5
MX  relexlm.com   alt3.aspmx.l.google.com  Priority 10
MX  relexlm.com   alt4.aspmx.l.google.com  Priority 10
```
(Use the exact MX values Google Workspace shows in its setup wizard — they are standard but confirm the list there.)

### Step 4 — SPF for Google (root TXT)
Add to root:
```text
TXT  relexlm.com  v=spf1 include:_spf.google.com ~all
```
Note: root currently has no SPF, so no merge needed. The `notify.relexlm.com` SPF (mailgun) lives on its own hostname and is untouched.

### Step 5 — DKIM (Google Workspace → Gmail → Authenticate email)
1. In Google Workspace admin, generate the DKIM record (2048-bit).
2. Add it in the Lovable DNS manager as either a CNAME or TXT (Google tells you which):
   - CNAME: `google._domainkey.relexlm.com` → `<long>.dkim.googlehosted.com`
   - or TXT: `google._domainkey` = `v=DKIM1; k=rsa; p=…`

### Step 6 — DMARC (recommended)
```text
TXT  _dmarc.relexlm.com  v=DMARC1; p=quarantine; rua=mailto:support@relexlm.com
```
Start with `p=quarantine`; tighten to `p=reject` after a few weeks once mail flows cleanly.

## What stays unchanged
- Lovable outbound app/auth email on `notify.relexlm.com` — untouched.
- The ReLex site (A record 185.158.133.1) — untouched.
- No code changes, no edge function changes, no app wiring in this plan.

## Verification / acceptance
- `dig MX relexlm.com` returns Google's `aspmx.l.google.com`.
- `dig TXT relexlm.com` returns the Google verification token + SPF.
- Email sent to `support@relexlm.com` arrives in the Google Workspace inbox.
- App still sends outbound email successfully (Lovable queue healthy).

## Caveats
- I cannot add DNS records for you — the Lovable DNS manager is UI-only; you add them in Workspace settings → Workspace domains → Configure.
- DNS propagation: TXT/MX changes are usually live within minutes at Name.com, occasionally up to 72h globally.
- Once `support@` and `privacy@` are live, we can wire them into the app (Privacy Policy contact, Terms contact, contact form) as a follow-up.
