

## Fix: Switch embedding calls from Lovable AI Gateway to OpenAI API

### Problem
The Lovable AI Gateway does not support the `/v1/embeddings` endpoint or `text-embedding-3-small` model. All 50 chunks per batch fail with a 400 error.

### Solution
Switch all three edge functions that call `/v1/embeddings` to use the OpenAI API directly (`https://api.openai.com/v1/embeddings`) with a new `OPENAI_API_KEY` secret.

### Steps

1. **Add `OPENAI_API_KEY` secret** -- prompt you to enter your OpenAI API key

2. **Update `supabase/functions/batch-embed-chunks/index.ts`**
   - Change URL from `https://ai.gateway.lovable.dev/v1/embeddings` to `https://api.openai.com/v1/embeddings`
   - Use `OPENAI_API_KEY` instead of `LOVABLE_API_KEY` for the Authorization header

3. **Update `supabase/functions/legal-qa/index.ts`** (line ~338)
   - Same URL and key change for the `getQueryEmbedding` function

4. **Update `supabase/functions/search-legal-sources/index.ts`** (line ~11)
   - Same URL and key change for the `getEmbedding` function

5. **Redeploy** all three edge functions

### Cost estimate
~361K chunks x ~500 tokens avg = ~180M tokens. At $0.02/1M tokens for `text-embedding-3-small`, total cost is approximately **$3.60**.

