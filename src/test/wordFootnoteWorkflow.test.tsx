import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {WordFootnoteWorkflow} from '../components/WordFootnoteWorkflow';
const mocks=vi.hoisted(()=>({inspect:vi.fn(),embed:vi.fn(),checkGroup:vi.fn(),run:vi.fn(),account:'a',project:'p'}));
vi.mock('@/lib/docxFootnoteRoundtrip',()=>({inspectDocxFootnotes:mocks.inspect,embedStyledFootnotes:mocks.embed,checkStyledFootnote:vi.fn(async()=>null),checkStyledFootnotes:mocks.checkGroup}));
vi.mock('@/lib/runCitation',()=>({runCitation:mocks.run}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mocks.account}})}));
vi.mock('@/hooks/useProjects',()=>({useProjects:()=>({currentProject:{id:mocks.project}})}));
vi.mock('@/lib/costTelemetry',()=>({newTelemetryBatch:()=>({}),sourceTelemetry:()=>({})}));
vi.mock('../components/CitationRequestStatusLink',()=>({CitationRequestStatusLink:({requestId}:any)=><span>{requestId}</span>}));
const text='explain; Author, Title (2020); ending';
const note=(value=text)=>({id:'42',text:value,editableRanges:[{start:0,end:value.length}],paragraphRanges:[{start:0,end:value.length}]});
async function upload(){const f=new File(['synthetic'],'paper.docx');Object.defineProperty(f,'arrayBuffer',{value:async()=>new ArrayBuffer(1)});fireEvent.change(screen.getByLabelText('מסמך DOCX'),{target:{files:[f]}});await screen.findByText('paper.docx');}
function select(start:number,end:number){const el=screen.getByLabelText('טקסט מקורי של הערה 1') as HTMLTextAreaElement;el.setSelectionRange(start,end);fireEvent.select(el);}
function protect(start:number,end:number){select(start,end);fireEvent.click(screen.getByRole('button',{name:/^(זה טקסט הסבר|שמור סימון הסבר)/}));}
function review(){fireEvent.click(screen.getByRole('button',{name:'המשך לבדיקת ההערות'}));}
function generate(){fireEvent.click(screen.getByRole('button',{name:/^בדוק \d+ מקורות$/}));}
async function result(){await waitFor(()=>expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toHaveValue('Corrected'));}
function approve(){fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'}));}
function back(){fireEvent.click(screen.getByRole('button',{name:'חזרה לטקסט הסבר שלא לשנות'}));}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.account='a';mocks.project='p';mocks.inspect.mockResolvedValue({notes:[note('Author, Title (2020)')],skippedNotes:[]});mocks.run.mockResolvedValue({citation:'Corrected',status:'valid',sourceType:'book'});mocks.embed.mockResolvedValue(new Uint8Array([1]));mocks.checkGroup.mockResolvedValue(null);URL.createObjectURL=vi.fn(()=>'blob:test');URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});});
describe('Word default engine flow',()=>{
 it('makes no automatic calls and sends a full unmarked note to the SAME engine contract',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();expect(mocks.run).not.toHaveBeenCalled();review();generate();await result();
  expect(mocks.run).toHaveBeenCalledTimes(1);expect(mocks.run.mock.calls[0][0]).toMatchObject({rawInput:'Author, Title (2020)',projectId:'p',useVerifiedStore:true});expect(localStorage.length).toBe(0);
 });
 it('excludes two protected spans, preserves offsets on approved export and invalidates edits',async()=>{
  mocks.inspect.mockResolvedValue({notes:[note(text)],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();protect(0,7);protect(30,text.length);review();generate();await result();
  expect(mocks.run.mock.calls[0][0].rawInput).toBe('; Author, Title (2020);');approve();
  expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('explain; Corrected; ending');
  fireEvent.change(screen.getByLabelText('התיקון המוצע לאזכור 1'),{target:{value:'Edited'}});expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeDisabled();expect(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'})).toBeDisabled();mocks.run.mockResolvedValueOnce({citation:'Edited',status:'valid',sourceType:'book'});fireEvent.click(screen.getByRole('button',{name:'בדוק שוב אזכור 1'}));await screen.findByLabelText('תצוגה מעוצבת לאזכור 1');expect(mocks.run.mock.calls[1][0].rawInput).toBe('Edited');approve();
  fireEvent.click(screen.getByRole('button',{name:/המשך להורדה/}));fireEvent.click(screen.getByRole('button',{name:/הורדת עותק מתוקן/}));await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  expect(mocks.embed.mock.calls[0][1]).toEqual([expect.objectContaining({id:'42',start:9,end:29,replacement:'Edited',approved:true})]);expect(mocks.embed.mock.calls[0][2]).toHaveLength(2);
 });
 it('one prefix protection excludes prose; removing or editing protection clears proposals and approval',async()=>{
  const value='explain Author';mocks.inspect.mockResolvedValue({notes:[note(value)],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();protect(0,8);review();generate();await result();expect(mocks.run.mock.calls[0][0].rawInput).toBe('Author');approve();back();
  fireEvent.click(screen.getByRole('button',{name:'שינוי הסבר 1'}));protect(0,7);review();expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toHaveValue('');expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeDisabled();generate();await result();expect(mocks.run.mock.calls[1][0].rawInput).toBe(' Author');approve();back();fireEvent.click(screen.getByRole('button',{name:'הסר הגנה 1'}));review();generate();await result();expect(mocks.run.mock.calls[2][0].rawInput).toBe(value);
 });
 it('entirely protected notes skip and overlaps cannot corrupt protection',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();protect(0,20);select(0,4);fireEvent.click(screen.getByRole('button',{name:/זה טקסט הסבר/}));expect(screen.getByRole('alert')).toHaveTextContent('חופפת');review();expect(screen.getByRole('button',{name:'אין הערות נוספות לבדיקה'})).toBeDisabled();expect(mocks.run).not.toHaveBeenCalled();
 });
 it('keeps mixed sources and separated candidate spans unresolved with no request',async()=>{
  mocks.inspect.mockResolvedValue({notes:[note('A (2020); B (2021)')],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();expect(screen.getByText('דורש טיפול נוסף')).toBeInTheDocument();review();expect(mocks.run).not.toHaveBeenCalled();expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('A (2020); B (2021)');
 });
 it('handles visually split runs without technical consent',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('Author Title'),editableRanges:[{start:0,end:6},{start:6,end:12}]}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();review();expect(screen.queryByLabelText('אישור איחוד עיצוב באזכור 1')).not.toBeInTheDocument();generate();await result();approve();expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeEnabled();
 });
 it('keeps an unsafe approved note unchanged while exporting another',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('Author, Title (2020)'),id:'42'},{...note('Other, Book (2021)'),id:'7'}],skippedNotes:[]});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(2));await result();approve();fireEvent.change(screen.getByLabelText('בחירת הערה'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 2'}));
  mocks.checkGroup.mockImplementation(async(_s:any,patches:any[])=>patches[0].id==='42'?'unsafe':null);fireEvent.click(screen.getByRole('button',{name:/המשך להורדה/}));fireEvent.click(screen.getByRole('button',{name:/הורדת עותק מתוקן/}));await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));expect(mocks.embed.mock.calls[0][1].map((p:any)=>p.id)).toEqual(['7']);expect(await screen.findByText(/נשארו ללא שינוי כי לא ניתן היה לשמר/)).toBeInTheDocument();
 });
 it('blocks repeated clicks, reset prevents stale delivery and pending note cannot be resent',async()=>{
  let resolve!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>resolve=r));render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'הבדיקה מתבצעת…'}));expect(screen.getByRole('button',{name:'חזרה לטקסט הסבר שלא לשנות'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'סגירה וניקוי'}));expect(mocks.run.mock.calls[0][0].isResultCurrent()).toBe(false);await upload();review();expect(screen.getByRole('button',{name:'אין הערות נוספות לבדיקה'})).toBeDisabled();await act(async()=>resolve({citation:'Late',status:'valid',sourceType:'book'}));expect(screen.queryByDisplayValue('Late')).not.toBeInTheDocument();
 });
 it('keeps uncertain request locked after changing protection and reimport',async()=>{
  mocks.run.mockRejectedValue({requestId:'pending-123',userMessage:'uncertain'});render(<WordFootnoteWorkflow/>);await upload();review();generate();await screen.findAllByText('pending-123');back();protect(0,7);review();expect(screen.getByRole('button',{name:'אין הערות נוספות לבדיקה'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'סגירה וניקוי'}));await upload();review();expect(screen.getByRole('button',{name:'אין הערות נוספות לבדיקה'})).toBeDisabled();expect(mocks.run).toHaveBeenCalledTimes(1);
 });
 it('clears state on account change while request is in flight',async()=>{
  let resolve!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>resolve=r));const view=render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(1));mocks.account='other';view.rerender(<WordFootnoteWorkflow/>);await act(async()=>resolve({citation:'Late',status:'valid',sourceType:'book'}));expect(screen.queryByText('paper.docx')).not.toBeInTheDocument();expect(screen.queryByDisplayValue('Late')).not.toBeInTheDocument();
 });
 it('rejects an ambiguous multi-source engine result instead of allowing export',async()=>{
  mocks.run.mockResolvedValue({citation:'A (2020); B (2021)',status:'valid',sourceType:'book'});render(<WordFootnoteWorkflow/>);await upload();review();generate();await screen.findByText(/התוצאה עשויה לכלול כמה מקורות/);expect(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'})).toBeDisabled();expect(screen.getByLabelText('תצוגת הערה 1')).toHaveTextContent('Author, Title (2020)');
 });
 it('passes source override and has no free raw-input field that could resend protected text',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();review();fireEvent.change(screen.getByLabelText('סוג המקור לאזכור 1'),{target:{value:'article'}});generate();await result();expect(mocks.run.mock.calls[0][0].overrideType).toBe('article');expect(screen.queryByLabelText('נוסח לבדיקה חוזרת לאזכור 1')).not.toBeInTheDocument();
 });
 it('uses the shared foreign jurisdiction plan, preserves it through navigation and never persists document text',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();review();
  fireEvent.change(screen.getByLabelText('סוג המקור לאזכור 1'),{target:{value:'foreign_case_other'}});
  fireEvent.click(screen.getByRole('button',{name:'שינוי סיווג'}));
  const addJur=screen.queryByRole('button',{name:'הוספת תחום שיפוט (לא חובה לסוג מקור זה)'});if(addJur)fireEvent.click(addJur);
  fireEvent.change(screen.getByLabelText(/^תחום שיפוט/),{target:{value:'t2:united-kingdom'}});
  expect(mocks.run).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  back();review();generate();await result();
  expect(mocks.run.mock.calls[0][0].manualChoice).toMatchObject({jurisdiction:'UK'});
  expect(mocks.run.mock.calls[0][0].rawInput).toBe('Author, Title (2020)');expect(localStorage.length).toBe(0);
 });

 it('does not submit existing unbound repeated citations or approve newly returned ones',async()=>{
  mocks.inspect.mockResolvedValueOnce({notes:[note('שם, בעמ׳ 12.')],skippedNotes:[]});
  render(<WordFootnoteWorkflow/>);await upload();expect(screen.getByText(/אין עדיין קישור מאומת/)).toBeInTheDocument();review();expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'סגירה וניקוי'}));await upload();review();mocks.run.mockResolvedValue({citation:'Ibid.',status:'valid',sourceType:'book'});generate();
  await screen.findByText(/הפניה למקור קודם שלא קושר/);expect(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'})).toBeDisabled();
 });

 it('automatically maps and checks two complete sources around protected explanation with separate approvals',async()=>{
  const a='Brown v. Board of Education, 347 U.S. 483 (1954)',b='Roe v. Wade, 410 U.S. 113 (1973)',explanation=' protected explanation ';
  const value=a+explanation+b;mocks.inspect.mockResolvedValue({notes:[note(value)],skippedNotes:[]});mocks.run.mockImplementation(async({rawInput}:any)=>({citation:rawInput,status:'valid',sourceType:'book'}));
  render(<WordFootnoteWorkflow/>);await upload();protect(a.length,a.length+explanation.length);review();
  expect(screen.getByText(/מתוכננות עד 2 בקשות למקורות מתוך 1 הערות/)).toBeInTheDocument();generate();
  await waitFor(()=>expect(screen.getByLabelText('התיקון המוצע לאזכור 251')).toHaveValue(b));expect(mocks.run.mock.calls.map(c=>c[0].rawInput)).toEqual([a,b]);
  approve();expect(screen.getByRole('button',{name:/המשך להורדה · 1 אושרו/})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 251'}));fireEvent.click(screen.getByRole('button',{name:/המשך להורדה/}));fireEvent.click(screen.getByRole('button',{name:/הורדת עותק מתוקן/}));
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());expect(mocks.embed.mock.calls[0][1]).toHaveLength(2);expect(mocks.embed.mock.calls[0][1].map((p:any)=>[p.start,p.end])).toEqual([[0,a.length],[a.length+explanation.length,value.length]]);
 });
 it('displays repeated forms before approval and invalidates downstream approval when earlier effective content changes',async()=>{
  const a='Brown v. Board of Education, 347 U.S. 483 (1954)';const notes=[{...note(a),id:'42'},{...note(a),id:'7'}];
  mocks.inspect.mockResolvedValue({notes,documentOrder:[{id:'42',number:10},{id:'7',number:11}],skippedNotes:[]});mocks.run.mockImplementation(async({rawInput}:any)=>({citation:rawInput,status:'valid',sourceType:'book'}));
  render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByRole('button',{name:'הצע אזכורים חוזרים לבדיקה'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'הצע אזכורים חוזרים לבדיקה'}));fireEvent.change(screen.getByLabelText('בחירת הערה'),{target:{value:'1'}});expect(screen.getByLabelText('התיקון המוצע לאזכור 2')).toHaveValue('שם.');
  fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 2'}));expect(screen.getByLabelText('תצוגת הערה 2')).toHaveTextContent('שם.');
  fireEvent.change(screen.getByLabelText('בחירת הערה'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('התיקון המוצע לאזכור 1'),{target:{value:'Changed source'}});
  fireEvent.change(screen.getByLabelText('בחירת הערה'),{target:{value:'1'}});expect(screen.getByLabelText('התיקון המוצע לאזכור 2')).toHaveValue(a);expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeDisabled();
 });
 it('offers an exact-offset two-tap alternative without native text selection',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();fireEvent.click(screen.getByText('סימון בלחיצות — גם בנייד'));fireEvent.click(screen.getByRole('button',{name:'מילה 1: Author,'}));fireEvent.click(screen.getByRole('button',{name:'מילה 2: Title'}));
  expect(screen.getByText('הקטע שנבחר:',{exact:true}).parentElement).toHaveTextContent('Author, Title');fireEvent.click(screen.getByRole('button',{name:'זה טקסט הסבר — לא לשנות'}));
  expect(screen.getByText('הסבר מוגן: Author, Title')).toBeInTheDocument();
 });

});

it('shows preserved-navigation field update guidance without making provider calls',async()=>{
 const warning='תוכן העניינים והפניות העמוד נשמרו ללא חישוב מחדש. לאחר התיקון יש לעדכן שדות ולבדוק עימוד ב-Word.';
 mocks.inspect.mockResolvedValue({notes:[note()],skippedNotes:[],warnings:[warning]});
 render(<WordFootnoteWorkflow/>);await upload();expect(screen.getByText(warning)).toBeInTheDocument();
 expect(screen.getByText(/שדות בתוך הערות/)).toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
});
