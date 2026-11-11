import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CitationPlanOffers } from '../components/CitationPlanOffers';
import { CITATION_CHECKOUT_ENABLED, CITATION_OFFERS } from '../lib/citationOffers';
import { CITATION_PASS_OFFERS } from '../../supabase/functions/_shared/citationPassOffers';
import { PLANS, isFixedTerm, PUBLIC_PLAN_ORDER } from '../lib/plans';

describe('selected one-time citation passes, before payment activation', () => {
  it('ILS 39 buys 100 sources for 7 days; ILS 65 buys 250 sources for one calendar month', () => {
    expect(CITATION_OFFERS.map(p => [p.id,p.priceIls,p.currency,p.sourceCount,p.term.unit,p.term.count])).toEqual([
      ['citation_week_pass_v1',39,'ILS',100,'day',7], ['citation_month_pass_v1',65,'ILS',250,'calendar_month',1],
    ]);
  });
  it('both offers are one-time and never renew automatically', () => {
    for (const p of CITATION_PASS_OFFERS) { expect(p.billing).toBe('one_time'); expect(p.autoRenew).toBe(false); }
  });
  it('the site catalogue is derived from the server catalogue', () => {
    expect(CITATION_OFFERS.map(({ id, priceIls, currency, sourceCount, term, billing, autoRenew }) =>
      ({ id, priceIls, currency, sourceCount, term, billing, autoRenew }))).toEqual(CITATION_PASS_OFFERS);
  });
  it('legacy account plans are unchanged and separate', () => {
    for (const p of CITATION_OFFERS) expect(PLANS).not.toHaveProperty(p.id);
    expect([PLANS.week.priceLabel,PLANS.week.includedUnits,isFixedTerm('week')]).toEqual(['₪29',45,true]);
    expect([PLANS.month.priceLabel,PLANS.month.includedUnits,isFixedTerm('month')]).toEqual(['₪69',140,true]);
    expect(PUBLIC_PLAN_ORDER).toEqual(['trial']);
  });
  it('account page shows one-time wording, no renewal claim, and disabled purchase', () => {
    const { container } = render(<CitationPlanOffers />);
    expect(screen.getByText('₪39 בתשלום חד־פעמי')).toBeInTheDocument();
    expect(screen.getByText('₪65 בתשלום חד־פעמי')).toBeInTheDocument();
    expect(screen.getByText('100 מקורות ל־7 ימים')).toBeInTheDocument();
    expect(screen.getByText('250 מקורות לחודש קלנדרי אחד')).toBeInTheDocument();
    expect(container.textContent).toContain('ללא חידוש אוטומטי');
    expect(container.textContent).not.toMatch(/מתחדש(ים|ת)? אוטומטית/);
    expect(container.textContent).not.toContain('לשבוע');
    expect(screen.getByRole('note')).toHaveTextContent('הרכישה עדיין לא נפתחה');
    expect(screen.getAllByText(/ללא כלי המחקר המשפטי/)).toHaveLength(2);
    expect(CITATION_CHECKOUT_ENABLED).toBe(false);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('both offer presentations consume the canonical catalogue, with no checkout call', () => {
    expect(readFileSync('src/pages/Profile.tsx','utf8')).toContain('<CitationPlanOffers />');
    expect(readFileSync('src/pages/Landing.tsx','utf8')).toContain('<LaunchPricing />');
    for (const path of ['src/components/CitationPlanOffers.tsx','src/components/launch/LaunchPricing.tsx']) {
      const source = readFileSync(path,'utf8');
      expect(source).toContain('CITATION_OFFERS');
      expect(source).not.toContain('PLANS[');
      expect(source).not.toContain('citation-pass-checkout');
      expect(source).not.toContain('functions.invoke');
    }
  });
});
