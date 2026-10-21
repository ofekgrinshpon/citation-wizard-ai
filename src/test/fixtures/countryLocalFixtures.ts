export const COUNTRY_LOCAL_FIXTURES = [
  { id: 'au.case.reported', j: 'AU', raw: 'Wattle v Harbour (2020) 270 CLR 10, 14 (Austl.).', output: '##Wattle v Harbour## (2020) 270 CLR 10, 14 (Austl.).' },
  { id: 'au.case.neutral', j: 'AU', raw: 'Wattle v Harbour [2020] FCA 123 (4 March 2020) (Austl.).', output: '##Wattle v Harbour## [2020] FCA 123 (4 March 2020) (Austl.).' },
  { id: 'au.statute.cth', j: 'AU', raw: 'Synthetic Records Act 2020 (Cth) ss 4–6 (Austl.).', output: '##Synthetic Records Act 2020## (Cth) ss 4–6 (Austl.).' },
  { id: 'ca.case.scc_neutral', j: 'CA', raw: 'Maple v. Cedar, 2020 SCC 12, para. 8 (Can.).', output: 'Maple v. Cedar, 2020 SCC 12, para. 8 (Can.).' },
  { id: 'ca.case.scr', j: 'CA', raw: 'Maple v. Cedar, [2020] 2 S.C.R. 100, 104 (Can.).', output: 'Maple v. Cedar, [2020] 2 S.C.R. 100, 104 (Can.).' },
  { id: 'ca.statute.federal', j: 'CA', raw: 'Synthetic Records Act, R.S.C. 1985, c S-7 (Can.).', output: 'Synthetic Records Act, R.S.C. 1985, c S-7 (Can.).' },
] as const;

/** QA corrections on 491f1e75: natural forms the first slice rejected or rendered redundantly. */
export const COUNTRY_LOCAL_QA_FIXTURES = [
  { id: 'ca.statute.federal.code', j: 'CA', raw: 'Criminal Code, R.S.C. 1985, c C-46 (Can.).', output: 'Criminal Code, R.S.C. 1985, c C-46 (Can.).' },
  { id: 'ca.statute.federal.fr', j: 'CA', raw: 'Loi synthétique, R.S.C. 1985, c C-46 (Can.).', output: 'Loi synthétique, R.S.C. 1985, c C-46 (Can.).' },
  { id: 'au.statute.cth.chain', j: 'AU', raw: 'Synthetic Records Act 2020 (Cth) pt 2 div 3 s 4 sch 1 (Austl.).', output: '##Synthetic Records Act 2020## (Cth) pt 2 div 3 s 4 sch 1 (Austl.).' },
  { id: 'au.statute.cth.ranges', j: 'AU', raw: 'Synthetic Records Act 2020 (Cth) pts 2–3 divs 4–5 schs 1–2 (Austl.).', output: '##Synthetic Records Act 2020## (Cth) pts 2–3 divs 4–5 schs 1–2 (Austl.).' },
  { id: 'ca.case.scr.equal_year', j: 'CA', raw: 'Maple v. Cedar (2020), [2020] 2 S.C.R. 100, 104 (Can.).', output: 'Maple v. Cedar, [2020] 2 S.C.R. 100, 104 (Can.).' },
] as const;
