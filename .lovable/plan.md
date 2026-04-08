

# Auto-Fetch Apify Dataset into the App

## How it works
A new edge function will call the Apify API to fetch your Actor's latest dataset results, then pass them directly to the existing `apify-ingest-cases` ingestion pipeline. In the admin panel, you'll get a single "Fetch from Apify" button instead of copy-pasting JSON.

## Changes

### 1. Store Apify API Token as a secret
You'll need your Apify API token (found at https://console.apify.com/account/integrations -> API tokens). We'll store it securely as a backend secret called `APIFY_API_TOKEN`.

### 2. New Edge Function: `fetch-apify-dataset`
- Accepts `{ actorId?: string, datasetId?: string }` in the request body
- Calls the Apify API: `GET https://api.apify.com/v2/acts/{actorId}/runs/last/dataset/items?token=...`
- Returns the JSON array of scraped items
- Admin-only auth gate (same pattern as existing functions)

### 3. Update `ApifyIngestionPanel.tsx`
- Add a "Fetch from Apify" button above the manual JSON textarea
- On click: calls `fetch-apify-dataset` to get the data, then sends it to `apify-ingest-cases` for ingestion
- Shows a progress indicator and result summary
- The manual paste option remains as a fallback

### 4. No database changes needed
The existing `legal_documents` table and ingestion pipeline handle everything already.

## Technical details

**Apify API endpoint:**
```
GET https://api.apify.com/v2/acts/{actorId}/runs/last/dataset/items
?token={APIFY_API_TOKEN}
&format=json
```

**Edge function flow:**
```text
Admin clicks "Fetch"
  -> fetch-apify-dataset (gets items from Apify API)
  -> returns JSON array to client
  -> client sends array to apify-ingest-cases (existing)
  -> documents ingested with chunking + embeddings
```

