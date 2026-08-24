# court-egress relay (official_court_egress_path_v1)

A ~90-line relay that fetches **public** Israeli court document URLs already discovered by
the ReLex pipeline, from a network the court origin answers. It is not a proxy: only
`https://*.court.gov.il`, GET only, token-protected, one request at a time.

## 1. Run it

Any small host with Node 18+ (a €4 VPS is enough; an Israeli IP is the safest choice —
Supabase Edge and Cloudflare egress are both reset by the origin).

```bash
scp server.mjs user@your-host:/opt/court-egress/server.mjs
ssh user@your-host
export RELAY_TOKEN=$(openssl rand -hex 32)   # keep this value
PORT=8787 RELAY_TOKEN=$RELAY_TOKEN node /opt/court-egress/server.mjs
```

Keep it alive with systemd (or `pm2`), and put it behind HTTPS (Caddy one-liner:
`your-domain.com { reverse_proxy localhost:8787 }`). **HTTPS is required** — ReLex refuses
a non-`https://` relay template.

## 2. Smoke-test it

```bash
curl -s -o /tmp/j.pdf -w '%{http_code} %{content_type} %{size_download}\n' \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H 'X-Fwd-User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' \
  -H 'X-Fwd-Accept-Language: he-IL,he;q=0.9' \
  -H 'X-Fwd-Referer: https://supremedecisions.court.gov.il/Home/Search' \
  --get --data-urlencode 'url=https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts\15/390/073/t06&fileName=15073390.t06&type=4' \
  https://your-domain.com/fetch
```

Expected: `200 application/pdf 364164`.

## 3. Tell ReLex about it

Send me the domain and the token; I add two backend secrets:

| Secret | Value |
|---|---|
| `COURT_EGRESS_URL_TEMPLATE` | `https://your-domain.com/fetch?url={url_encoded}` |
| `COURT_EGRESS_TOKEN` | the `RELAY_TOKEN` value |

Until both exist the egress path stays completely inert — the pipeline behaves exactly as
it does today.

## Limits already enforced on the ReLex side

Fallback only (after the edge fetch resets), `*.court.gov.il` allowlist, max 3 relay
fetches per run, ≥1 s spacing, 1.2 s→5 s backoff, stop after 2 consecutive failures,
cache-first, and full per-attempt telemetry. Relayed bytes still have to pass extraction,
identity validation, source-integrity, verifier, claim-source-match and sufficiency before
anything can be cited.
