

## Fix: Save Resume State on ALL Errors (Not Just AUTH_EXPIRED)

### Problem
In `handleFetchFromApify` catch block (line 401-408), the code only saves resume state when the error is `AUTH_EXPIRED`. For any other error like "Failed to fetch" (network timeout, edge function crash), the progress is lost and you have to start over.

### Changes

**`src/components/admin/ApifyIngestionPanel.tsx`** -- catch block in `handleFetchFromApify`

Update lines 401-408 to always save resume state regardless of error type:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : "שגיאה בשליפה מ-Apify";
  // Always save resume state so the user can continue
  saveApifyResume(sourceId, offset, pageNum, acc, [], 0);
  if (msg === "AUTH_EXPIRED") {
    toast.warning("החיבור פג זמנית – אפשר להמשיך מאותה נקודה");
  } else {
    toast.warning(`${msg} – אפשר להמשיך מאותה נקודה`);
  }
}
```

Also add retry logic for the page fetch itself (lines 369-376), similar to `ingestBatchWithRetry` -- retry the `fetch-apify-dataset` call up to 2 times with a 3s delay before giving up:

```typescript
let fetchRes: Response | null = null;
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    if (attempt > 0) {
      setProgressMsg(`ניסיון חוזר ${attempt} לשליפת עמוד ${pageNum}...`);
      await sleep(RETRY_DELAY_MS);
    }
    fetchRes = await resilientFetch(...);
    if (fetchRes.ok) break;
  } catch (e) {
    if (attempt === MAX_RETRIES) throw e;
  }
}
```

### Result
- "Failed to fetch" will save progress and show "אפשר להמשיך מאותה נקודה" instead of losing everything
- Page fetches get 2 retries before pausing (handles transient network issues)
- Resume button continues from exactly where it stopped

