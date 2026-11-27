# Official BGB metadata fallback
Download the official Government BGB archive (https://www.gesetze-im-internet.de/bgb/xml.zip) and run:

    python scripts/extract_bgb_titles.py /path/to/xml.zip > supabase/functions/citation-chat/germanBgbTitles.ts

The source hash and build date are embedded in the generated module. This does not store statutory text, authenticate a requested historical version, or represent the latest amendment. It is only a bounded fallback for section existence and heading on a transient live-source failure. It never overrides a contradictory or missing live record and stops being usable 45 days after the official snapshot build date. Refresh through the normal reviewed release process.
