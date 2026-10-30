import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WordFootnoteWorkflow } from '../components/WordFootnoteWorkflow';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), embed: vi.fn(), run: vi.fn(), account: 'a', project: 'p' }));
vi.mock('@/lib/docxFootnoteRoundtrip', () => ({ inspectDocxFootnotes: mocks.inspect, embedApprovedFootnotes: mocks.embed }));
vi.mock('../components/CitationRequestStatusLink', () => ({ CitationRequestStatusLink: ({requestId}: {requestId?: string}) => requestId ? <span>request:{requestId}</span> : null }));
vi.mock('@/lib/runCitation', () => ({ runCitation: mocks.run }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({user: {id: mocks.account}}) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({currentProject: {id: mocks.project}}) }));
vi.mock('@/lib/costTelemetry', () => ({newTelemetryBatch: () => ({}), sourceTelemetry: () => ({})}));
const original = 'prefix citation suffix';
const session = {notes: [{id:'42', text:original, editableRanges:[{start:0,end:22}]}, {id:'7', text:'second citation', editableRanges:[{start:0,end:15}]}], skippedNotes:[], warnings:[]};
const button = (name: string | RegExp) => screen.getByRole('button', {name});
const click = (name: string | RegExp) => fireEvent.click(button(name));
function file(name='paper.docx') {const f=new File(['fake'],name);Object.defineProperty(f,'arrayBuffer',{value:async()=>new ArrayBuffer(1)});return f;}
async function upload(name='paper.docx') {fireEvent.change(screen.getByLabelText('מסמך DOCX'),{target:{files:[file(name)]}});await screen.findByText(name);}
function chooseNote(n:number) {fireEvent.change(screen.getByLabelText('בחירת הערה'),{target:{value:String(n-1)}});}
function selection(n:number,start:number,end:number) {const el=screen.getByLabelText('טקסט מקורי של הערה '+n) as HTMLTextAreaElement;el.setSelectionRange(start,end);fireEvent.select(el);}
function select(n:number,start:number,end:number,explanation=false) {click('בחירת אזכורים');chooseNote(n);selection(n,start,end);fireEvent.click(screen.getByText(explanation?'הגן על הקטע כהסבר':'הוסף לרשימת הבדיקה',{exact:true}));}
function generate() {click('בדיקת תיקונים');click(/^בדוק \d+ אזכורים$/);}
const approve=(id=1)=>click('אשר תיקון לאזכור '+id);
const edit=(id:number,value:string)=>fireEvent.change(screen.getByLabelText('התיקון המוצע לאזכור '+id),{target:{value}});
const preview=(n=1)=>screen.getByLabelText('תצוגת הערה '+n);
async function ready(id=1) {await waitFor(()=>expect(button('אשר תיקון לאזכור '+id)).toBeEnabled());}
async function download() {click('הורדת עותק');click(/^הורדת עותק מתוקן/);await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());await waitFor(()=>expect(button('החלפת מסמך')).toBeEnabled());}
const marks=()=>screen.getByRole('group',{name:'טקסט ההערה 1 עם הסימונים'}).querySelectorAll('mark');
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();mocks.account='a';mocks.project='p';
 mocks.inspect.mockResolvedValue(session);mocks.embed.mockResolvedValue(new Uint8Array([1]));mocks.run.mockResolvedValue({citation:'corrected',status:'valid',sourceType:'book'});
 URL.createObjectURL=vi.fn(()=>'blob:test');URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
});
describe('Guided Word workflow with real review cards',()=>{
 it('shows filename, focuses step heading, and opens only one note at a time',async()=>{
  render(<WordFootnoteWorkflow/>);expect(button('בחירת מסמך Word')).toBeEnabled();await upload();
  expect(button('החלפת מסמך')).toBeEnabled();expect(button('בחירת אזכורים')).toHaveAttribute('aria-current','step');
  expect(screen.getByRole('heading',{name:'בחירת אזכורים'})).toHaveFocus();expect(screen.queryByLabelText('טקסט מקורי של הערה 2')).not.toBeInTheDocument();
  click('הערה הבאה');expect(screen.queryByLabelText('טקסט מקורי של הערה 1')).not.toBeInTheDocument();click('הערה קודמת');
  expect(screen.getByLabelText('טקסט מקורי של הערה 1')).toHaveValue(original);expect(mocks.run).not.toHaveBeenCalled();expect(button('בדיקת תיקונים')).toBeDisabled();
 });
 it('back/next keeps highlights and never dispatches until the explicit check; export contains only approval',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);expect(marks()[0]).toHaveTextContent('citation');
  click('המשך לבדיקת 1 אזכורים');expect(mocks.run).not.toHaveBeenCalled();expect(screen.getAllByText(/משתמשת במכסת החשבון/).length).toBeGreaterThan(0);
  click('חזרה לבחירת אזכורים');expect(marks()).toHaveLength(1);generate();await ready();expect(mocks.run.mock.calls[0][0].rawInput).toBe('citation');
  expect(preview()).toHaveTextContent(original);approve();await download();
  expect(mocks.embed.mock.calls[0][1]).toEqual([{id:'42',originalText:original,start:7,end:15,replacement:'corrected',approved:true}]);
  expect(mocks.embed.mock.calls[0][2]).toEqual([]);expect(localStorage.length).toBe(0);
 });
 it('protects multiple explanations, retains unclassified text and invalidates output edits',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,0,6,true);select(1,16,22,true);select(1,7,15);expect(marks()).toHaveLength(3);
  generate();await ready();approve();expect(preview()).toHaveTextContent('prefix corrected suffix');edit(1,'edited');expect(preview()).toHaveTextContent(original);
  approve();await download();expect(mocks.embed.mock.calls[0][2]).toEqual([{noteId:'42',id:'42',originalText:original,start:0,end:6},{noteId:'42',id:'42',originalText:original,start:16,end:22}]);
 });
 it('independent approvals survive another edit; clearing/retyping output and changing boundaries are safe',async()=>{
  mocks.run.mockImplementation(async({rawInput}:any)=>({citation:rawInput.toUpperCase(),status:'valid',sourceType:'book'}));
  render(<WordFootnoteWorkflow/>);await upload();select(1,0,6);select(1,7,15);generate();await ready(2);approve(1);approve(2);
  edit(1,'');expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toBeEnabled();expect(preview()).toHaveTextContent('prefix CITATION suffix');
  edit(1,'retyped');approve(1);expect(preview()).toHaveTextContent('retyped CITATION suffix');
  click('בחירת אזכורים');click('שינוי הבחירה באזכור 1');selection(1,1,6);click('שמור את הבחירה החדשה');click('בדיקת תיקונים');
  expect(preview()).toHaveTextContent('prefix CITATION suffix');expect(button('אשר תיקון לאזכור 1')).toBeDisabled();
 });
 it('source type and search input invalidate approval without changing the selected original span',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();await ready();approve();
  fireEvent.change(screen.getByLabelText('סוג המקור לאזכור 1'),{target:{value:'article'}});expect(button('הורדת עותק')).toBeDisabled();
  generate();await ready();approve();fireEvent.change(screen.getByLabelText('נוסח לבדיקה חוזרת לאזכור 1'),{target:{value:'new search'}});
  expect(preview()).toHaveTextContent(original);generate();await ready();approve();await download();
  expect(mocks.run.mock.calls[2][0].rawInput).toBe('new search');expect(mocks.embed.mock.calls[0][1][0]).toMatchObject({start:7,end:15,originalText:original});
 });
 it('deletion removes highlights and approved corrections; protection can be removed separately',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,0,6,true);select(1,7,15);generate();await ready();approve();click('בחירת אזכורים');click('הסר אזכור 1 מהרשימה');
  expect(marks()).toHaveLength(1);expect(button('הורדת עותק')).toBeDisabled();click('הסר הגנה מהקטע prefix');expect(marks()).toHaveLength(0);
 });
 it('rejects overlap without removing existing spans',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);select(1,0,8,true);expect(screen.getByRole('alert')).toHaveTextContent('חופפת');
  select(1,0,6,true);select(1,0,8);expect(screen.getByRole('alert')).toHaveTextContent('חופפת');expect(marks()).toHaveLength(2);expect(mocks.run).not.toHaveBeenCalled();
 });
 it('locks repeated clicks and back/next while busy; close suppresses stale results and unlocks host',async()=>{
  let resolve!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>{resolve=r;}));const busy=vi.fn();render(<WordFootnoteWorkflow onBusyChange={busy}/>);await upload();select(1,7,15);generate();
  click('הבדיקה מתבצעת…');expect(mocks.run).toHaveBeenCalledTimes(1);expect(button('בחירת אזכורים')).toBeDisabled();expect(screen.getByLabelText('בחירת הערה')).toBeDisabled();expect(busy).toHaveBeenLastCalledWith(true);
  click('סגירה וניקוי');expect(mocks.run.mock.calls[0][0].isResultCurrent()).toBe(false);await act(async()=>resolve({citation:'late',status:'valid',sourceType:'book'}));
  expect(screen.queryByText('late')).not.toBeInTheDocument();expect(screen.queryByText('paper.docx')).not.toBeInTheDocument();expect(busy).toHaveBeenLastCalledWith(false);
 });
 it.each(['account','project'] as const)('clears document and late replies when %s changes',async key=>{
  let resolve!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();mocks[key]='changed';view.rerender(<WordFootnoteWorkflow/>);
  await act(async()=>resolve({citation:'secret',status:'valid',sourceType:'book'}));expect(screen.queryByText('secret')).not.toBeInTheDocument();expect(screen.queryByText('paper.docx')).not.toBeInTheDocument();
 });
 it('requires explicit cross-run consent for generation/approval and resets it after new boundaries',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{id:'42',text:original,editableRanges:[{start:0,end:10},{start:10,end:22}]}],skippedNotes:[]});
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);click('בדיקת תיקונים');expect(button('אין אזכורים נוספים לבדיקה')).toBeDisabled();
  fireEvent.click(screen.getByText('בדוק שוב',{exact:true}));expect(mocks.run).not.toHaveBeenCalled();fireEvent.click(screen.getByLabelText('אישור איחוד עיצוב באזכור 1'));generate();await ready();approve();
  fireEvent.click(screen.getByLabelText('אישור איחוד עיצוב באזכור 1'));expect(button('אשר תיקון לאזכור 1')).toBeDisabled();expect(preview()).toHaveTextContent(original);
  fireEvent.click(screen.getByLabelText('אישור איחוד עיצוב באזכור 1'));approve();await download();expect(mocks.embed.mock.calls[0][1][0].allowFormattingNormalization).toBe(true);
  click('בחירת אזכורים');click('שינוי הבחירה באזכור 1');selection(1,0,15);click('שמור את הבחירה החדשה');expect(screen.getByLabelText('אישור איחוד עיצוב באזכור 1')).not.toBeChecked();expect(button('הורדת עותק')).toBeDisabled();
 });
 it('does not auto-select a citation-looking note or send a split Unicode character',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'Case 😀 (2020)',editableRanges:[{start:0,end:14}]}],skippedNotes:[]});
  render(<WordFootnoteWorkflow/>);await upload();expect(mocks.run).not.toHaveBeenCalled();select(1,5,6);expect(screen.getByRole('alert')).toHaveTextContent('תו');expect(button('בדיקת תיקונים')).toBeDisabled();
 });
 it('parses escaped citation markers once during export',async()=>{
  mocks.run.mockResolvedValue({citation:String.raw`C\#\# and \*\* and \^\^`,status:'valid',sourceType:'book'});
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();await ready();approve();await download();expect(mocks.embed.mock.calls[0][1][0].replacement).toBe('C## and ** and ^^');
 });
 it('shows plain Word suggestions and treats literal markers typed during editing as literal text',async()=>{
  mocks.run.mockResolvedValue({citation:'Author **Book title** (2020)',status:'valid',sourceType:'book'});
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();await ready();
  expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toHaveValue('Author Book title (2020)');
  edit(1,'literal **stars** and ##hashes##');approve();await download();
  expect(mocks.embed.mock.calls[0][1][0].replacement).toBe('literal **stars** and ##hashes##');
 });
 it('reserves pending notes through close/reimport and preserves late failure identity',async()=>{
  let reject!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise((_,r)=>{reject=r;}));render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();click('סגירה וניקוי');await upload();select(1,7,15);
  expect(screen.getByRole('alert')).toHaveTextContent('בקשה');await act(async()=>reject({userMessage:'uncertain',requestId:'request-123'}));
  expect(screen.getByText('request:request-123')).toBeInTheDocument();expect(mocks.run).toHaveBeenCalledTimes(1);
 });
 it('uncertain errors stay locked through edits, deleting the span and replacing the file',async()=>{
  mocks.run.mockRejectedValue({userMessage:'uncertain',requestId:'request-123'});render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();await screen.findByText('uncertain');
  expect(screen.getByText('בדוק שוב',{exact:true})).toBeDisabled();fireEvent.change(screen.getByLabelText('נוסח לבדיקה חוזרת לאזכור 1'),{target:{value:'different'}});
  expect(screen.getByText('בדוק שוב',{exact:true})).toBeDisabled();click('בחירת אזכורים');click('הסר אזכור 1 מהרשימה');await upload('replacement.docx');select(1,7,15);
  expect(screen.getByRole('alert')).toHaveTextContent('בקשה');expect(mocks.run).toHaveBeenCalledTimes(1);
 });
 it('skips another span in an uncertain note while continuing independent notes',async()=>{
  mocks.run.mockRejectedValueOnce({userMessage:'uncertain',requestId:'pending-1'}).mockResolvedValue({citation:'other-note',status:'valid',sourceType:'book'});
  render(<WordFootnoteWorkflow/>);await upload();select(1,0,6);select(1,7,15);select(2,0,6);generate();await ready(3);
  expect(mocks.run).toHaveBeenCalledTimes(2);expect(mocks.run.mock.calls[1][0].rawInput).toBe('second');chooseNote(1);
  expect(screen.getByLabelText('בדוק שוב אזכור 2')).toBeDisabled();
 });
 it('rejects cross-paragraph edits and preserves other paragraphs; skipped-note details stay collapsed',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{id:'42',text:'first\nsecond',editableRanges:[{start:0,end:5},{start:6,end:12}]}],skippedNotes:[{id:'7',reason:'complex'}]});
  render(<WordFootnoteWorkflow/>);await upload();select(1,0,12);expect(screen.getByRole('alert')).toHaveTextContent('פסקאות');expect(mocks.run).not.toHaveBeenCalled();
  select(1,6,12);generate();await ready();approve();expect(preview().textContent).toBe('first\ncorrected');expect(screen.getByText(/complex/).closest('details')).not.toHaveAttribute('open');
 });
 it('does not offer checking or download if all notes are unsupported',async()=>{
  mocks.inspect.mockResolvedValue({notes:[],skippedNotes:[{id:'42',reason:'complex'}]});render(<WordFootnoteWorkflow/>);await upload();
  expect(screen.getByText(/לא נמצאו הערות שאפשר לערוך בבטחה/)).toBeInTheDocument();expect(button('בדיקת תיקונים')).toBeDisabled();expect(button('הורדת עותק')).toBeDisabled();
 });
 it('repeated exports preserve approvals and replacing the file resets the review',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();select(1,7,15);generate();await ready();approve();await download();await download();expect(mocks.embed).toHaveBeenCalledTimes(2);
  expect(mocks.embed.mock.calls[1][1]).toEqual(mocks.embed.mock.calls[0][1]);await upload('new.docx');expect(screen.queryByText('paper.docx')).not.toBeInTheDocument();expect(button('הורדת עותק')).toBeDisabled();expect(mocks.run).toHaveBeenCalledTimes(1);
 });
});
