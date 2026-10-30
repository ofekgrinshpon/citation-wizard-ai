import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WordFootnoteWorkflow } from '../components/WordFootnoteWorkflow';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), embed: vi.fn(), run: vi.fn(), account: 'a', project: 'p' }));
vi.mock('@/lib/docxFootnoteRoundtrip', () => ({ inspectDocxFootnotes: mocks.inspect, embedApprovedFootnotes: mocks.embed }));
vi.mock('../components/CitationRequestStatusLink', () => ({ CitationRequestStatusLink: ({requestId}: {requestId?: string}) => requestId ? <span>request:{requestId}</span> : null }));
vi.mock('@/lib/runCitation', () => ({ runCitation: mocks.run }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.account } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ currentProject: { id: mocks.project } }) }));
vi.mock('@/lib/costTelemetry', () => ({ newTelemetryBatch: () => ({}), sourceTelemetry: () => ({}) }));
vi.mock('../components/FootnoteReviewCard', () => ({ FootnoteReviewCard: ({ cell, onApproveToggle, onOutputChange, onRegenerate, regenerationDisabled, disabled }: any) => <div>
  <span>{cell.output}</span>
  <button disabled={disabled || !cell.output} onClick={() => onApproveToggle(cell.id, !cell.approved)}>approve-{cell.id}</button>
  <button disabled={disabled} onClick={() => onOutputChange(cell.id, 'edited')}>edit-{cell.id}</button>
  <button disabled={disabled || regenerationDisabled} onClick={() => onRegenerate(cell.id)}>regenerate-{cell.id}</button>
</div> }));
const session = { notes: [{ id: '42', text: 'prefix citation suffix', editableRanges: [{start:0,end:22}] }, { id: '7', text: 'second citation', editableRanges: [{start:0,end:15}] }], warnings: [] };
function file() { const f = new File(['fake'], 'paper.docx'); Object.defineProperty(f, 'arrayBuffer', { value: async () => new ArrayBuffer(1) }); return f; }
async function upload() { fireEvent.change(screen.getByLabelText('מסמך DOCX'), { target: { files: [file()] } }); await screen.findByText(/paper.docx/); }
function select(id: number, start: number, end: number) { const el = screen.getByLabelText(`טקסט מקורי של הערה ${id}`) as HTMLTextAreaElement; el.setSelectionRange(start,end); fireEvent.select(el); const mark=screen.queryByText('סמן כאזכור לתיקון'); if(mark) fireEvent.click(mark); }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.account='a';mocks.project='p'; mocks.inspect.mockResolvedValue(session); mocks.embed.mockResolvedValue(new Uint8Array([1])); mocks.run.mockResolvedValue({ citation:'corrected',status:'valid',sourceType:'book' }); URL.createObjectURL=vi.fn(()=>'blob:test');URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}); });
describe('Word footnote workflow', () => {
  it('imports locally, sends only explicitly selected span, exports only approval by native ID', async () => {
    render(<WordFootnoteWorkflow/>); await upload(); expect(mocks.run).not.toHaveBeenCalled();
    select(1,7,15); fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));
    await screen.findByText('corrected'); expect(mocks.run.mock.calls[0][0].rawInput).toBe('citation');
    expect(screen.getByText(/הטמע 0/)).toBeDisabled(); fireEvent.click(screen.getByText('approve-1'));
    fireEvent.click(screen.getByText(/הטמע 1/)); await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
    expect(mocks.embed.mock.calls[0][2]).toEqual([]);
    expect(mocks.embed.mock.calls[0][1]).toEqual([{id:'42',originalText:'prefix citation suffix',start:7,end:15,replacement:'corrected',approved:true}]);
    expect(localStorage.length).toBe(0);
  });
  it('invalidates approval after editing output or changing selection', async () => {
    render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('corrected');
    fireEvent.click(screen.getByText('approve-1'));fireEvent.click(screen.getByText('edit-1'));expect(screen.getByText(/הטמע 0/)).toBeDisabled();
    fireEvent.click(screen.getByText('approve-1'));const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;el.setSelectionRange(0,6);fireEvent.select(el);fireEvent.click(screen.getByText('עדכן גבולות אזכור 1 לבחירה'));expect(screen.getByText(/הטמע 0/)).toBeDisabled();
  });
  it('blocks repeated generation clicks and stops stale delivery after close', async () => {
    let resolve!: (v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>resolve=r));render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);
    fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));expect(mocks.run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('סגור מסמך ונקה'));expect(mocks.run.mock.calls[0][0].isResultCurrent()).toBe(false);
    await act(async()=>resolve({citation:'late',status:'valid',sourceType:'book'}));expect(screen.queryByText('late')).not.toBeInTheDocument();expect(screen.queryByText(/paper.docx/)).not.toBeInTheDocument();
  });
  it('clears document and blocks late result across account change', async()=>{
    let resolve!: (v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>resolve=r));const view=render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));
    mocks.account='b';view.rerender(<WordFootnoteWorkflow/>);await act(async()=>resolve({citation:'secret',status:'valid',sourceType:'book'}));expect(screen.queryByText('secret')).not.toBeInTheDocument();expect(screen.queryByText(/paper.docx/)).not.toBeInTheDocument();
  });
  it('rejects spans across runs before any provider call', async()=>{
    mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'abc def',editableRanges:[{start:0,end:3},{start:4,end:7}]}],warnings:[]});render(<WordFootnoteWorkflow/>);await upload();select(1,0,7);expect(screen.getByRole('alert')).toHaveTextContent('חוצה');expect(mocks.run).not.toHaveBeenCalled();expect(screen.getByText('הפק טיוטות לאזכורים שסומנו')).toBeDisabled();
  });
  it('requires explicit cross-run normalization before generation and revokes approval when unchecked', async()=>{
    mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'prefix citation suffix',editableRanges:[{start:0,end:10},{start:10,end:22}]}],warnings:[]});
    render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);
    const consent=screen.getByLabelText('אישור איחוד עיצוב באזכור 1');
    expect(screen.getByText('הפק טיוטות לאזכורים שסומנו')).toBeDisabled();
    fireEvent.click(screen.getByText('regenerate-1'));expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(consent);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('corrected');
    expect(mocks.run.mock.calls[0][0].rawInput).toBe('citation');fireEvent.click(screen.getByText('approve-1'));
    fireEvent.click(consent);expect(screen.getByText(/הטמע 0/)).toBeDisabled();fireEvent.click(screen.getByText('approve-1'));expect(screen.getByText(/הטמע 0/)).toBeDisabled();
    fireEvent.click(consent);fireEvent.click(screen.getByText('approve-1'));fireEvent.click(screen.getByText(/הטמע 1/));
    await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());expect(mocks.embed.mock.calls[0][1][0].allowFormattingNormalization).toBe(true);
    const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;el.setSelectionRange(0,15);fireEvent.select(el);fireEvent.click(screen.getByText('עדכן גבולות אזכור 1 לבחירה'));expect(screen.getByLabelText('אישור איחוד עיצוב באזכור 1')).not.toBeChecked();expect(screen.getByText(/הטמע 0/)).toBeDisabled();
  });
  it('does not auto-select a citation-looking note or send a split surrogate', async()=>{
    mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'Case 😀 (2020)',editableRanges:[{start:0,end:14}]}],warnings:[]});
    render(<WordFootnoteWorkflow/>);await upload();expect(screen.queryByText('approve-1')).not.toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
    select(1,5,6);expect(screen.getByRole('alert')).toHaveTextContent('תו');expect(screen.getByText('הפק טיוטות לאזכורים שסומנו')).toBeDisabled();
  });
  it('preserves escaped literal formatting markers by parsing once on export', async()=>{
    mocks.run.mockResolvedValue({citation:String.raw`C\#\# and \*\* and \^\^`,status:'valid',sourceType:'book'});
    render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await waitFor(()=>expect(screen.getByText('approve-1')).not.toBeDisabled());fireEvent.click(screen.getByText('approve-1'));fireEvent.click(screen.getByText(/הטמע 1/));await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());expect(mocks.embed.mock.calls[0][1][0].replacement).toBe('C## and ** and ^^');
  });
  it('reserves an in-flight note across clear/reimport before the old response arrives', async()=>{
    let reject!: (v:any)=>void;mocks.run.mockImplementation(()=>new Promise((_,r)=>reject=r));render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));fireEvent.click(screen.getByText('סגור מסמך ונקה'));await upload();select(1,7,15);expect(screen.getByText('הפק טיוטות לאזכורים שסומנו')).toBeDisabled();expect(mocks.run).toHaveBeenCalledTimes(1);await act(async()=>reject({userMessage:'uncertain',requestId:'request-123'}));select(1,7,15);expect(mocks.run).toHaveBeenCalledTimes(1);expect(screen.getByText('request:request-123')).toBeInTheDocument();
  });
  it('keeps failed request identity locked through reselection and clear/reimport', async()=>{
    mocks.run.mockRejectedValue({userMessage:'uncertain',requestId:'request-123'});render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('request:request-123');select(1,7,15);fireEvent.click(screen.getByText('edit-1'));expect(screen.getByText('regenerate-1')).toBeDisabled();expect(mocks.run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('סגור מסמך ונקה'));await upload();select(1,7,15);expect(screen.getByRole('alert')).toHaveTextContent('בקשה');expect(screen.getByText('הפק טיוטות לאזכורים שסומנו')).toBeDisabled();expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('keeps several explanation spans and unclassified text unchanged in full-note preview and export', async()=>{
    render(<WordFootnoteWorkflow/>);await upload();
    const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;
    el.setSelectionRange(0,6);fireEvent.select(el);fireEvent.click(screen.getByText('סמן כטקסט הסבר מוגן'));
    el.setSelectionRange(16,22);fireEvent.select(el);fireEvent.click(screen.getByText('סמן כטקסט הסבר מוגן'));
    select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('corrected');
    expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('prefix citation suffix');
    fireEvent.click(screen.getByText('approve-1'));expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('prefix corrected suffix');
    fireEvent.click(screen.getByText('edit-1'));expect(screen.getAllByText(/טקסט הסבר מוגן:/)).toHaveLength(2);expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('prefix citation suffix');
    fireEvent.click(screen.getByText('approve-1'));fireEvent.click(screen.getByText(/הטמע 1/));await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
    expect(mocks.embed.mock.calls[0][2]).toEqual([{noteId:'42',id:'42',originalText:'prefix citation suffix',start:0,end:6},{noteId:'42',id:'42',originalText:'prefix citation suffix',start:16,end:22}]);
    expect(mocks.run.mock.calls[0][0].rawInput).toBe('citation');
  });
  it('composes multiple independent approvals in one note and invalidates only edited boundaries', async()=>{
    mocks.run.mockImplementation(async({rawInput}:any)=>({citation:rawInput.toUpperCase(),status:'valid',sourceType:'book'}));
    render(<WordFootnoteWorkflow/>);await upload();select(1,0,6);select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('CITATION');
    expect(mocks.run).toHaveBeenCalledTimes(2);fireEvent.click(screen.getByText('approve-1'));expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('PREFIX citation suffix');
    fireEvent.click(screen.getByText('approve-2'));expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('PREFIX CITATION suffix');
    const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;el.setSelectionRange(1,6);fireEvent.select(el);fireEvent.click(screen.getByText('עדכן גבולות אזכור 1 לבחירה'));
    expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('prefix CITATION suffix');expect(screen.getByText(/הטמע 1/)).not.toBeDisabled();
  });
  it('rejects overlaps without removing protected markers or approved proposals', async()=>{
    render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);
    const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;el.setSelectionRange(0,8);fireEvent.select(el);fireEvent.click(screen.getByText('סמן כטקסט הסבר מוגן'));
    expect(screen.getByRole('alert')).toHaveTextContent('חופפת');expect(screen.queryByText(/טקסט הסבר מוגן:/)).not.toBeInTheDocument();
    el.setSelectionRange(0,6);fireEvent.select(el);fireEvent.click(screen.getByText('סמן כטקסט הסבר מוגן'));
    select(1,0,8);expect(screen.getByRole('alert')).toHaveTextContent('חופפת');expect(screen.getAllByText(/טקסט הסבר מוגן:/)).toHaveLength(1);expect(screen.getByText('approve-1')).toBeInTheDocument();
  });
  it('reports skipped notes and leaves multi-paragraph unclassified text unchanged', async()=>{
    mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'first\nsecond',editableRanges:[{start:0,end:5},{start:6,end:12}],paragraphRanges:[{start:0,end:5},{start:6,end:12}]}],skippedNotes:[{id:'7',reason:'complex'}]});
    render(<WordFootnoteWorkflow/>);await upload();expect(screen.getByText(/1 הערות דולגו/)).toBeInTheDocument();expect(screen.getByText(/complex/)).toBeInTheDocument();
    select(1,0,12);expect(screen.getByRole('alert')).toHaveTextContent('פסקאות');expect(mocks.run).not.toHaveBeenCalled();
    select(1,6,12);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('corrected');fireEvent.click(screen.getByText('approve-1'));expect(screen.getByLabelText('תצוגת הערה 1').textContent).toBe('first\ncorrected');
  });
  it('does not dispatch another span in a note after an uncertain request, but independent notes continue', async()=>{
    mocks.run.mockRejectedValueOnce({userMessage:'uncertain',requestId:'pending-1'}).mockResolvedValue({citation:'other-note',status:'valid',sourceType:'book'});
    render(<WordFootnoteWorkflow/>);await upload();select(1,0,6);select(1,7,15);select(2,0,6);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await screen.findByText('other-note');
    expect(mocks.run).toHaveBeenCalledTimes(2);expect(mocks.run.mock.calls[1][0].rawInput).toBe('second');expect(screen.getByText('request:pending-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('regenerate-2'));expect(mocks.run).toHaveBeenCalledTimes(2);
  });
  it('never retries a failed/uncertain generation automatically' , async()=>{
    mocks.run.mockRejectedValue({userMessage:'uncertain'});render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);fireEvent.click(screen.getByText('הפק טיוטות לאזכורים שסומנו'));await waitFor(()=>expect(screen.getByText('regenerate-1')).toBeDisabled());expect(mocks.run).toHaveBeenCalledTimes(1);expect(screen.getByText(/הטמע 0/)).toBeDisabled();
  });
});
