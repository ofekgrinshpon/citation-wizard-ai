

## Change Required

Update the `ingest-knesset-research` edge function to use `doc.source_type` from the request body if provided, falling back to `'knesset_research'` if not.

## Single File Change

**File**: `supabase/functions/ingest-knesset-research/index.ts`

**Line 96**: Replace `source_type: "knesset_research",` with `source_type: (doc.source_type as string) || "knesset_research",`

This allows external ingestion pipelines to specify custom source types (e.g., `knesset_bill`, `knesset_protocol`) while maintaining backward compatibility for requests that don't include a `source_type` field.

