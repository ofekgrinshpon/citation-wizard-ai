import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WordFootnoteWorkflow } from '../components/WordFootnoteWorkflow';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), embed: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/docxFootnoteRoundtrip', () => ({ inspectDocxFootnotes: mocks.inspect, embedStyledFootnotes: mocks.embed, checkStyledFootnote: async () => null, checkStyledFootnotes: async () => null }));
vi.mock('@/lib/runCitation', () => ({ runCitation: mocks.run }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic-account' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ currentProject: { id: 'synthetic-project' } }) }));
vi.mock('@/lib/costTelemetry', () => ({ newTelemetryBatch: () => ({}), sourceTelemetry: () => ({}) }));
vi.mock('../components/CitationRequestStatusLink', () => ({ CitationRequestStatusLink: () => null }));
const first = 'Brown v. Board of Education, 347 U.S. 483 (1954)';
const second = 'Roe v. Wade, 410 U.S. 113 (1973)';
const original = `${first}; ${second}`;
async function upload() {
  const file = new File(['synthetic'], 'quota.docx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) });
  fireEvent.change(screen.getByLabelText('מסמך DOCX'), { target: { files: [file] } });
  await screen.findByText('quota.docx');
  fireEvent.click(screen.getByRole('button', { name: 'המשך לבדיקת ההערות' }));
}
const checkbox = (n: number) => screen.getByRole('checkbox', { name: new RegExp(`בחירת מקור ${n} ·`) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue({ notes: [{ id: '42', text: original, editableRanges: [{ start: 0, end: original.length }], paragraphRanges: [{ start: 0, end: original.length }] }], skippedNotes: [] });
  mocks.run.mockImplementation(async ({ rawInput }: { rawInput: string }) => ({ citation: rawInput, status: 'valid', sourceType: 'book' }));
  mocks.embed.mockResolvedValue(new Uint8Array([1]));
  URL.createObjectURL = vi.fn(() => 'blob:synthetic'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
describe('Word source-level shared trial selection', () => {
  it('preselects one source, never processes or exports the unselected span in the same note', async () => {
    render(<WordFootnoteWorkflow sourceQuota={{ remaining: 1 }} />); await upload();
    expect(checkbox(1)).toBeChecked(); expect(checkbox(2)).not.toBeChecked();
    expect(screen.getByText('לא נבדק במסגרת המכסה')).toBeVisible();
    expect(screen.getByText(second, { selector: 'p' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'בדוק 1 מקורות' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'אשר תיקון לאזכור 1' })).toBeEnabled());
    expect(mocks.run.mock.calls[0][0].rawInput).toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'אשר תיקון לאזכור 1' }));
    fireEvent.click(screen.getByRole('button', { name: /המשך להורדה · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /הורדת עותק מתוקן/ }));
    await waitFor(() => expect(mocks.embed).toHaveBeenCalledTimes(1));
    expect(mocks.embed.mock.calls[0][1]).toEqual([{ id: '42', originalText: original, start: 0, end: first.length, replacement: first, approved: true }]);
  });
  it('lets users swap the chosen source before processing', async () => {
    render(<WordFootnoteWorkflow sourceQuota={{ remaining: 1 }} />); await upload();
    fireEvent.click(checkbox(1)); fireEvent.click(checkbox(2));
    fireEvent.click(screen.getByRole('button', { name: 'בדוק 1 מקורות' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(mocks.run.mock.calls[0][0].rawInput).toBe(second);
  });
  it('blocks zero and loading quotas, then preselects only after loaded', async () => {
    const view = render(<WordFootnoteWorkflow sourceQuota={{ remaining: 5, loading: true }} />); await upload();
    expect(screen.getByRole('button', { name: 'אין הערות נוספות לבדיקה' })).toBeDisabled();
    expect(checkbox(1)).toBeDisabled(); expect(mocks.run).not.toHaveBeenCalled();
    view.rerender(<WordFootnoteWorkflow sourceQuota={{ remaining: 1 }} />);
    await waitFor(() => expect(checkbox(1)).toBeChecked());
    view.rerender(<WordFootnoteWorkflow sourceQuota={{ remaining: 0 }} />);
    await waitFor(() => expect(checkbox(1)).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'אין הערות נוספות לבדיקה' })).toBeDisabled();
  });
  it('keeps completed output downloadable after quota becomes zero, without selecting new work', async () => {
    const view = render(<WordFootnoteWorkflow sourceQuota={{ remaining: 1 }} />); await upload();
    fireEvent.click(screen.getByRole('button', { name: 'בדוק 1 מקורות' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'אשר תיקון לאזכור 1' })).toBeEnabled());
    view.rerender(<WordFootnoteWorkflow sourceQuota={{ remaining: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'אשר תיקון לאזכור 1' }));
    expect(screen.getByRole('button', { name: 'בדוק שוב אזכור 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'אין הערות נוספות לבדיקה' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /המשך להורדה · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /הורדת עותק מתוקן/ }));
    await waitFor(() => expect(mocks.embed).toHaveBeenCalledTimes(1));
    expect(mocks.embed.mock.calls[0][1]).toEqual([{ id: '42', originalText: original, start: 0, end: first.length, replacement: first, approved: true }]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('stops dispatch and preserves both sources when another tab took the last slot', async () => {
    mocks.run.mockRejectedValueOnce({ code: 'TRIAL_EXHAUSTED' });
    const view = render(<WordFootnoteWorkflow sourceQuota={{ remaining: 2 }} />); await upload();
    fireEvent.click(screen.getByRole('button', { name: 'בדוק 2 מקורות' }));
    await screen.findByText(/ניצלת את מכסת האזכורים בחינם/);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    view.rerender(<WordFootnoteWorkflow sourceQuota={{ remaining: 0 }} />);
    await waitFor(() => expect(screen.getAllByText('לא נבדק במסגרת המכסה')).toHaveLength(2));
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it('preserves the unmetered paid flow when no trial quota is supplied', async () => {
    render(<WordFootnoteWorkflow />); await upload();
    expect(screen.queryByRole('checkbox', { name: /בחירת מקור/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'בדוק 2 מקורות' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
  });
});
