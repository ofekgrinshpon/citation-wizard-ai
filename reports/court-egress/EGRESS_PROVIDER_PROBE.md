# official_court_egress_path_v1 — provider probe (read-only)

Target URL (public Supreme Court judgment PDF, discovered by search-first):
`supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts\15/390/073/t06&fileName=15073390.t06&type=4`

| Egress | Result |
|---|---|
| Sandbox IP, browser-like headers | **200 `application/pdf`, 364 164 bytes** |
| Supabase Edge runtime, same headers | `Connection reset by peer (os error 104)` at TCP/TLS — 3/3 attempts |
| ConvertAPI (`CONVERTAPI_SECRET`, server-side URL fetch) | **401 — stored credential invalid/expired** |
| Apify (`APIFY_API_TOKEN`) | **401 `user-or-token-not-found` — stored credential invalid/expired** |
| r.jina.ai reader | 422 `Timeout was reached` (origin never answered) |
| api.allorigins.win (Cloudflare) | 522 (origin connect timeout) |
| api.codetabs.com (Cloudflare) | 522 (origin connect timeout) |
| corsproxy.io | 403 (server-side requests require paid plan) |

Conclusions:
1. The block is at the **egress-network level**, confirmed again from the edge runtime.
2. **No usable third-party egress exists in the project today** — both stored provider
   credentials are dead, so option C is not available without a new credential.
3. Free/public relays fronted by Cloudflare are themselves unreachable from the origin
   (522), so a plain Cloudflare Worker (option B) is unlikely to work; the working path
   needs an egress the origin accepts (residential / IL-geo, or a small VM with a clean IP).

Implemented regardless (inert until configured): `lib/courtEgress.ts` +
fallback hook in `lib/officialFetch.ts`. See ACCEPTANCE_REPORT.md.
