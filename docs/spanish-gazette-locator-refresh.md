# Spanish Gazette locator refresh
Download selected official Gazette DOCX issues from the court's archive. Record archive issue, official URL, file checksum and extracted count in spanish-gazette-locator-provenance.json. Run:

    python scripts/extract_spanish_gazette_candidates.py <gazette-docx> ...

Use the output as the body of STC_GAZETTE_LOCATORS. Never resolve by Gazette contents alone: the runtime must check the original decision type, number, year, date and exact ECLI. Include only successfully parsed issues and rerun the continental and real handler test suites. The Gazette is published periodically on the court's timetable and is not comprehensive at any given date. Missing entries do not imply that a decision does not exist.
