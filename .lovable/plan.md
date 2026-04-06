

# Fix: Case law search not triggering for hyphen-formatted case numbers

## Problem

When you typed `רע״א 5768-94`, the UI showed "מחפש פסק דין" (that part works -- it's triggered by client-side source type detection). But on the server, the Perplexity search **never actually ran** because the regex that extracts the case number only accepts a slash (`/`) separator, not a hyphen (`-`).

The regex on line 474 of `citation-chat/index.ts`:
```
([0-9]+\/[0-9]+)
```
Your input: `5768-94` (hyphen) -- no match, so `caseNumberMatch` is `null`, the Perplexity call is skipped entirely, and the AI generates the citation without any search data.

## Solution

**File: `supabase/functions/citation-chat/index.ts`** (line 474)

Change the case number regex from `[0-9]+\/[0-9]+` to `[0-9]+[\/\-][0-9]+` so it accepts both `5768/94` and `5768-94`. Then normalize the hyphen to a slash before sending to Perplexity (since the official format uses `/`).

Also apply the same fix to the standalone `case-law-search/index.ts` edge function for consistency.

## Changes

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Accept `-` in addition to `/` in case number regex; normalize to `/` before search |
| `supabase/functions/case-law-search/index.ts` | Same hyphen-to-slash normalization for the case number input |

This is a one-line regex fix. After this, typing `רע״א 5768-94` will correctly trigger the Perplexity search and return real case data.

