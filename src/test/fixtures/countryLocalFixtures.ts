export const COUNTRY_LOCAL_FIXTURES = [
  { id: 'au.case.reported', j: 'AU', raw: 'Wattle v Harbour (2020) 270 CLR 10, 14 (Austl.).', output: '##Wattle v Harbour## (2020) 270 CLR 10, 14 (Austl.).' },
  { id: 'au.case.neutral', j: 'AU', raw: 'Wattle v Harbour [2020] FCA 123 (4 March 2020) (Austl.).', output: '##Wattle v Harbour## [2020] FCA 123 (4 March 2020) (Austl.).' },
  { id: 'au.statute.cth', j: 'AU', raw: 'Synthetic Records Act 2020 (Cth) ss 4–6 (Austl.).', output: '##Synthetic Records Act 2020## (Cth) ss 4–6 (Austl.).' },
  { id: 'ca.case.scc_neutral', j: 'CA', raw: 'Maple v. Cedar, 2020 SCC 12, para. 8 (Can.).', output: 'Maple v. Cedar, 2020 SCC 12, para. 8 (Can.).' },
  { id: 'ca.case.scr', j: 'CA', raw: 'Maple v. Cedar, [2020] 2 S.C.R. 100, 104 (Can.).', output: 'Maple v. Cedar, [2020] 2 S.C.R. 100, 104 (Can.).' },
  { id: 'ca.statute.federal', j: 'CA', raw: 'Synthetic Records Act, R.S.C. 1985, c S-7 (Can.).', output: 'Synthetic Records Act, R.S.C. 1985, c S-7 (Can.).' },
] as const;
