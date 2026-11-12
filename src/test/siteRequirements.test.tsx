import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
vi.mock('@/components/ReLexLogo',()=>({ReLexLogo:()=> <span>ReLex</span>}));
vi.mock('@/components/ContactSection',()=>({ContactSection:()=> <form aria-label="existing contact form"/>}));
import BusinessInfo from '../pages/BusinessInfo';
import { LaunchPricing } from '../components/launch/LaunchPricing';
afterEach(cleanup);
describe('public business pages',()=>{
 it('shows factual capabilities and caveat without an invented operator/contact',()=>{
  render(<MemoryRouter><BusinessInfo page="about"/></MemoryRouter>);
  expect(screen.getByRole('heading',{level:1}).textContent).toBe('אודות ReLex');
  expect(screen.getByText(/ReLex אינו נותן ייעוץ משפטי/)).toBeTruthy();
  expect(screen.getAllByRole('link').some(a=>a.getAttribute('href')==='/contact')).toBe(true);
  expect(document.querySelector('a[href^="tel:"]')).toBeNull();
 });
 it('reuses contact form and exposes published billing email',()=>{
  render(<MemoryRouter><BusinessInfo page="contact"/></MemoryRouter>);
  expect(screen.getByRole('form')).toBeTruthy();
  expect(screen.getByRole('link',{name:'billing@relexlm.com'}).getAttribute('href')).toBe('mailto:billing@relexlm.com');
 });
 it('keeps the two checkout buttons disabled',()=>{
  render(<LaunchPricing/>);
  expect(screen.getAllByRole('button').length).toBe(2);
  for(const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('₪39 בתשלום חד־פעמי')).toBeTruthy();
  expect(screen.getByText('₪65 בתשלום חד־פעמי')).toBeTruthy();
 });
 it('registers public routes and removes the stale billing-cycle teaser',()=>{
  const app=readFileSync('src/App.tsx','utf8');
  for(const route of ['/about','/contact']) expect(app).toContain(`path="${route}"`);
  const landing=readFileSync('src/pages/Landing.tsx','utf8');
  expect(landing).not.toContain('מחזור חיוב');
  expect(landing).toContain('ללא חידוש אוטומטי');
 });
});

describe('approved unpublished legal amendments',()=>{
 it('sets the approved delivery deadline and start of term',()=>{
  const terms=readFileSync('src/content/legal/terms.ts','utf8');
  expect(terms).toContain('בתוך 24 שעות ממועד אימות התשלום');
  expect(terms).toContain('יחלו רק עם פתיחת הגישה בפועל, ולא ממועד התשלום');
 });
 it('keeps the exact approved refund protection and limits discretionary refunds',()=>{
  const terms=readFileSync('src/content/legal/terms.ts','utf8');
  expect(terms).toContain('אם השירות שנרכש לא סופק, הלקוח יהיה זכאי להשבת הסכום ששולם בעדו. החזר בשל אי־אספקה אינו מותנה בשיקול דעת המפעיל או בבקשה בתוך שבעה ימים. אין באמור כדי לגרוע מכל זכות ביטול או החזר המוקנית לפי דין.');
  expect(terms).toContain('ובמקרים שאינם מקנים זכות להחזר לפי דין או לפי תנאים אלה');
  expect(terms).not.toContain('לאחר מכן, החזרים יינתנו לפי שיקול דעת');
  expect(readFileSync('src/content/legal/version.ts','utf8')).toContain('LEGAL_VERSION = "2026-11-12"');
 });
});

describe('public release excludes private operator draft',()=>{
 it('contains no new personal identity fields',()=>{
  const terms=readFileSync('src/content/legal/terms.ts','utf8');
  expect(terms).not.toContain('תעודת זהות:');
  expect(terms).not.toContain('שם: אופק');
  expect(terms).not.toContain('\nכתובת:');
 });
});
