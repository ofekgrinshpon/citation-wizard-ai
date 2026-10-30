import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CitationPlanOffers } from '../components/CitationPlanOffers';
import { CITATION_CHECKOUT_ENABLED, CITATION_OFFERS } from '../lib/citationOffers';
import { PLANS, isFixedTerm, PUBLIC_PLAN_ORDER } from '../lib/plans';

describe('selected citation-only offers, before payment activation', () => {
  it('separates recurring source offers from existing fixed-term accounts', () => {
    expect(CITATION_OFFERS.map(p => [p.id,p.priceIls,p.sourceUnits,p.interval,p.intervalCount])).toEqual([
      ['citation_weekly_v1',39,100,'week',1], ['citation_monthly_v1',65,250,'month',1],
    ]);
    for (const p of CITATION_OFFERS) expect(PLANS).not.toHaveProperty(p.id);
    expect([PLANS.week.priceLabel,PLANS.week.includedUnits,isFixedTerm('week')]).toEqual(['₪29',45,true]);
    expect([PLANS.month.priceLabel,PLANS.month.includedUnits,isFixedTerm('month')]).toEqual(['₪69',140,true]);
    expect(PUBLIC_PLAN_ORDER).toEqual(['trial']);
  });
  it('shows source counts and renewal, with both purchase actions disabled', () => {
    render(<CitationPlanOffers />);
    expect(screen.getByText('₪39 לשבוע')).toBeInTheDocument();
    expect(screen.getByText('₪65 לחודש')).toBeInTheDocument();
    expect(screen.getByText('100 מקורות בכל מחזור שבועי')).toBeInTheDocument();
    expect(screen.getByText('250 מקורות בכל מחזור חודשי')).toBeInTheDocument();
    expect(screen.getByText(/מתחדשים אוטומטית עד לביטול/)).toHaveTextContent('ולא 30 ימים קבועים');
    expect(screen.getByText(/הורדה או הטמעה חוזרת/)).toBeInTheDocument();
    expect(screen.getAllByText(/ללא כלי המחקר המשפטי/)).toHaveLength(2);
    expect(CITATION_CHECKOUT_ENABLED).toBe(false);
    for(const button of screen.getAllByRole('button')) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('both public offer surfaces use the same disabled component, leaving account metadata separate',()=>{
    for(const path of ['src/pages/Profile.tsx','src/pages/Landing.tsx']) {
      const source=readFileSync(path,'utf8');expect(source).toContain('<CitationPlanOffers />');expect(source).not.toContain('PRICING_PLANS');
    }
  });
});
