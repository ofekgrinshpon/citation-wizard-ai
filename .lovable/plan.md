

## Set APIFY_API_TOKEN for Local Script Access

### What's happening
The `APIFY_API_TOKEN` secret already exists but you need to know its value to use in your local script. I'll generate a strong random token, update the secret, and share the value with you.

### Plan
1. Generate a secure random 64-character hex token
2. Update the `APIFY_API_TOKEN` secret with this new value
3. Share the token value so you can use it in your local script's `Authorization: Bearer <token>` header
4. Build the `ingest-knesset-research` edge function (as previously approved)
5. Update `supabase/config.toml` with the new function config

### Files
- **New**: `supabase/functions/ingest-knesset-research/index.ts`
- **Edit**: `supabase/config.toml`

### Local usage
```bash
curl -X POST "https://ioktiqcffungtlsmlkcv.supabase.co/functions/v1/ingest-knesset-research" \
  -H "Authorization: Bearer <the-token-I-will-share>" \
  -H "Content-Type: application/json" \
  -d '{"documents": [...]}'
```

