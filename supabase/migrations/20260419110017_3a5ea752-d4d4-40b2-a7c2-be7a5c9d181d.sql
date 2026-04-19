UPDATE public.legal_documents
SET 
  title = 'פרטי מסמך',
  citation = 'פרטי מסמך (מרכז המחקר והמידע של הכנסת)',
  metadata = (metadata - 'recovered_title' - 'recovery_method' - 'recovered_at' - 'publication_date' - 'broken_title' - 'broken_title_checked_at')
WHERE source_type = 'knesset_research'
  AND (metadata->>'recovered_title' = 'true' OR metadata->>'broken_title' = 'true');