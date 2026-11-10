import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {WordFootnoteWorkflow} from '../components/WordFootnoteWorkflow';
const mocks=vi.hoisted(()=>({inspect:vi.fn(),embed:vi.fn(),check:vi.fn(),checkGroup:vi.fn(),run:vi.fn(),account:'a',project:'p'}));
vi.mock('@/lib/docxFootnoteRoundtrip',()=>({inspectDocxFootnotes:mocks.inspect,embedStyledFootnotes:mocks.embed,checkStyledFootnote:mocks.check,checkStyledFootnotes:mocks.checkGroup}));
vi.mock('@/lib/runCitation',()=>({runCitation:mocks.run}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mocks.account}})}));
vi.mock('@/hooks/useProjects',()=>({useProjects:()=>({currentProject:{id:mocks.project}})}));
vi.mock('@/lib/costTelemetry',()=>({newTelemetryBatch:()=>({}),sourceTelemetry:()=>({})}));
vi.mock('../components/CitationRequestStatusLink',()=>({CitationRequestStatusLink:({requestId}:any)=><span>{requestId}</span>}));
const text='explain; Author, Title (2020); ending';
const note=(value=text)=>({id:'42',text:value,editableRanges:[{start:0,end:value.length}],paragraphRanges:[{start:0,end:value.length}]});
async function upload(){const f=new File(['synthetic'],'paper.docx');Object.defineProperty(f,'arrayBuffer',{value:async()=>new ArrayBuffer(1)});fireEvent.change(screen.getByLabelText('מסמך DOCX'),{target:{files:[f]}});await screen.findByText('paper.docx');}
function select(start:number,end:number){const el=screen.getByLabelText('טקסט מקורי של הערה במיקום 1') as HTMLTextAreaElement;el.setSelectionRange(start,end);fireEvent.select(el);}
function protect(start:number,end:number){select(start,end);fireEvent.click(screen.getByRole('button',{name:/^(זה טקסט הסבר|שמור סימון הסבר)/}));}
function review(){fireEvent.click(screen.getByRole('button',{name:'המשך לבדיקת ההערות'}));}
function generate(){fireEvent.click(screen.getByRole('button',{name:/^בדוק \d+ מקורות$/}));}
async function result(){await waitFor(()=>expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toHaveValue('Corrected'));}
function approve(){fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'}));}
function openCard(name:RegExp){const b=screen.getByRole('button',{name});if(b.getAttribute('aria-expanded')!=='true')fireEvent.click(b);}
function back(){fireEvent.click(screen.getByRole('button',{name:'חזרה לטקסט הסבר שלא לשנות'}));}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.account='a';mocks.project='p';mocks.inspect.mockResolvedValue({notes:[note('Author, Title (2020)')],skippedNotes:[]});mocks.run.mockResolvedValue({citation:'Corrected',status:'valid',sourceType:'book'});mocks.embed.mockResolvedValue(new Uint8Array([1]));mocks.checkGroup.mockResolvedValue(null);mocks.check.mockResolvedValue(null);URL.createObjectURL=vi.fn(()=>'blob:test');URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});});
describe('Word default engine flow',()=>{
 it('makes no automatic calls and sends a full unmarked note to the SAME engine contract',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();expect(mocks.run).not.toHaveBeenCalled();review();generate();await result();
  expect(mocks.run).toHaveBeenCalledTimes(1);expect(mocks.run.mock.calls[0][0]).toMatchObject({rawInput:'Author, Title (2020)',projectId:'p',useVerifiedStore:true});expect(localStorage.length).toBe(0);
 });
 it('excludes two protected spans, preserves offsets on approved export and invalidates edits',async()=>{
  mocks.inspect.mockResolvedValue({notes:[note(text)],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();protect(0,7);protect(30,text.length);review();generate();await result();
  expect(mocks.run.mock.calls[0][0].rawInput).toBe('; Author, Title (2020);');approve();
  expect(screen.getByLabelText('תצוגת הערה במיקום 1')).toHaveTextContent('explain; Corrected; ending');
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
  mocks.inspect.mockResolvedValue({notes:[note('A (2020); B (2021)')],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();expect(screen.getByText('דורש טיפול נוסף')).toBeInTheDocument();review();expect(mocks.run).not.toHaveBeenCalled();expect(screen.getByLabelText('תצוגת הערה במיקום 1')).toHaveTextContent('A (2020); B (2021)');
 });
 it('handles visually split runs without technical consent',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('Author Title'),editableRanges:[{start:0,end:6},{start:6,end:12}]}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();review();expect(screen.queryByLabelText('אישור איחוד עיצוב באזכור 1')).not.toBeInTheDocument();generate();await result();approve();expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeEnabled();
 });
 it('keeps an unsafe approved note unchanged while exporting another',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('Author, Title (2020)'),id:'42'},{...note('Other, Book (2021)'),id:'7'}],skippedNotes:[]});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByRole('button',{name:/הערה במיקום 2 ·/})).toHaveAttribute('aria-expanded','true'));expect(screen.getByRole('button',{name:/הערה במיקום 1 ·/})).toHaveAttribute('aria-expanded','true');openCard(/הערה במיקום 1 ·/);await result();approve();openCard(/הערה במיקום 2 ·/);fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 2'}));
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
  mocks.run.mockResolvedValue({citation:'A (2020); B (2021)',status:'valid',sourceType:'book'});render(<WordFootnoteWorkflow/>);await upload();review();generate();await screen.findByText(/התוצאה עשויה לכלול כמה מקורות/);expect(screen.getByRole('button',{name:'אשר תיקון לאזכור 1'})).toBeDisabled();expect(screen.getByLabelText('תצוגת הערה במיקום 1')).toHaveTextContent('Author, Title (2020)');
 });
 it('passes source override and has no free raw-input field that could resend protected text',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();review();fireEvent.change(screen.getByLabelText('סוג המקור לאזכור 1'),{target:{value:'article'}});generate();await result();expect(mocks.run.mock.calls[0][0].overrideType).toBe('article');expect(screen.queryByLabelText('נוסח לבדיקה חוזרת לאזכור 1')).not.toBeInTheDocument();
 });
 it('uses the shared foreign jurisdiction plan, preserves it through navigation and never persists document text',async()=>{
  render(<WordFootnoteWorkflow/>);await upload();review();
  fireEvent.change(screen.getByLabelText('סוג המקור לאזכור 1'),{target:{value:'foreign_case_other'}});
  fireEvent.click(screen.getByRole('button',{name:'שינוי סיווג'}));fireEvent.click(screen.getByRole('button',{name:'הגדרות מתקדמות'}));
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
  fireEvent.click(screen.getByRole('button',{name:'הצע אזכורים חוזרים לבדיקה'}));openCard(/הערת שוליים 11 ·/);expect(screen.getByLabelText('התיקון המוצע לאזכור 2')).toHaveValue('שם.');
  fireEvent.click(screen.getByRole('button',{name:'אשר תיקון לאזכור 2'}));expect(screen.getByLabelText('תצוגת הערה 11')).toHaveTextContent('שם.');
  openCard(/הערת שוליים 10 ·/);fireEvent.change(screen.getByLabelText('התיקון המוצע לאזכור 1'),{target:{value:'Changed source'}});
  expect(screen.getByLabelText('התיקון המוצע לאזכור 2')).toHaveValue(a);expect(screen.getByRole('button',{name:/המשך להורדה/})).toBeDisabled();
 });
 it('lists 39 notes in document order across both steps without dispatch, including skipped and unresolved numbering',async()=>{
  const order=Array.from({length:39},(_,i)=>({id:String(900-i*7),number:i===2?null:i+20}));
  const notes=order.filter((_,i)=>i!==1&&i!==29).map(x=>({...note('Repeated source (2020)'),id:x.id}));
  mocks.inspect.mockResolvedValue({notes,documentOrder:order,skippedNotes:[{id:order[1].id,reason:'מבנה לא נתמך'},{id:order[29].id,reason:'לא ניתן לערוך'}],skippedCount:2});
  render(<WordFootnoteWorkflow/>);await upload();const list=screen.getByRole('list',{name:'רשימת הערות שוליים'});expect(within(list).getAllByRole('listitem')).toHaveLength(39);expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('הערת שוליים 21');expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('נשארת ללא שינוי');expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('מספר Word לא ידוע');
  const first=within(list).getByRole('button',{name:/הערת שוליים 20 ·/});expect(first).toHaveAttribute('aria-expanded','false');fireEvent.click(first);expect(first).toHaveAttribute('aria-expanded','true');expect(screen.getByLabelText('טקסט מקורי של הערה 20')).toHaveValue('Repeated source (2020)');fireEvent.click(first);expect(mocks.run).not.toHaveBeenCalled();review();expect(within(screen.getByRole('list',{name:'רשימת הערות שוליים'})).getAllByRole('listitem')).toHaveLength(39);fireEvent.click(screen.getByRole('button',{name:/הערת שוליים 58 ·/}));expect(screen.getByRole('button',{name:'בדוק אזכור 37'})).toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
 });
 it('checks only the chosen note and leaves another card untouched',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('First (2020)'),id:'70'},{...note('Second (2021)'),id:'3'}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();review();fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 2 ·/}));fireEvent.click(screen.getByRole('button',{name:'בדוק אזכור 2'}));await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(1));expect(mocks.run.mock.calls[0][0].rawInput).toBe('Second (2021)');expect(await screen.findByLabelText('התיקון המוצע לאזכור 2')).toHaveValue('Corrected');fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 1 ·/}));expect(screen.getByLabelText('התיקון המוצע לאזכור 1')).toHaveValue('');
 });
 it('stops a sequential batch after the in-flight request without dispatching later notes',async()=>{
  let resolve!:(v:any)=>void;mocks.run.mockImplementation(()=>new Promise(r=>resolve=r));mocks.inspect.mockResolvedValue({notes:[{...note('First (2020)'),id:'70'},{...note('Second (2021)'),id:'3'}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(1));expect(screen.getByText(/בודקים מקור 1 מתוך 2/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'עצור שליחת בקשות נוספות'}));expect(screen.getByText(/העצירה מתבצעת/)).toBeInTheDocument();await act(async()=>resolve({citation:'First',status:'valid',sourceType:'book'}));await screen.findByText(/הבדיקה נעצרה; בקשות נוספות/);expect(mocks.run).toHaveBeenCalledTimes(1);
 });
 it('does not call the provider for a refused link crossing and keeps the session usable',async()=>{
  mocks.check.mockResolvedValueOnce('האזכור חוצה בין קישורים');render(<WordFootnoteWorkflow/>);await upload();review();generate();await screen.findByText(/לא ניתן לשמור את עיצוב האזכור בבטחה/);expect(screen.getByText('הסיבה: האזכור חוצה בין קישורים.')).toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'חזרה לטקסט הסבר שלא לשנות'})).toBeEnabled();back();expect(screen.getByLabelText('טקסט מקורי של הערה במיקום 1')).toHaveValue('Author, Title (2020)');
 });
 it('stops while a local preflight is pending before sending any request',async()=>{
  let resolve!:(v:any)=>void;mocks.check.mockImplementation(()=>new Promise(r=>resolve=r));render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.check).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'עצור שליחת בקשות נוספות'}));await act(async()=>resolve(null));await screen.findByText(/הבדיקה נעצרה; בקשות נוספות/);expect(mocks.run).not.toHaveBeenCalled();
 });
 it('keeps explanations isolated when two note cards are open',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('Alpha first (2020)'),id:'81'},{...note('Beta second (2021)'),id:'4'}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 1 ·/}));fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 2 ·/}));
  const first=screen.getByLabelText('טקסט מקורי של הערה במיקום 1') as HTMLTextAreaElement;first.setSelectionRange(0,5);fireEvent.select(first);fireEvent.click(screen.getByRole('button',{name:/סמן הסבר · הערה במיקום 1/}));
  const second=screen.getByLabelText('טקסט מקורי של הערה במיקום 2') as HTMLTextAreaElement;second.setSelectionRange(0,4);fireEvent.select(second);fireEvent.click(screen.getByRole('button',{name:/סמן הסבר · הערה במיקום 2/}));expect(screen.getByText('הסבר מוגן: Alpha')).toBeInTheDocument();expect(screen.getByText('הסבר מוגן: Beta')).toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
 });
 it('clears a pending selection when a native range crosses two notes',async()=>{
  mocks.inspect.mockResolvedValue({notes:[{...note('First text (2020)'),id:'9'},{...note('First text (2020)'),id:'2'}],skippedNotes:[]});render(<WordFootnoteWorkflow/>);await upload();fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 1 ·/}));fireEvent.click(screen.getByRole('button',{name:/הערה במיקום 2 ·/}));
  const field=screen.getByLabelText('טקסט מקורי של הערה במיקום 1') as HTMLTextAreaElement;field.setSelectionRange(0,5);fireEvent.select(field);const button=screen.getByRole('button',{name:/סמן הסבר · הערה במיקום 1/});expect(button).toBeEnabled();
  const first=screen.getByRole('group',{name:'טקסט הערה במיקום 1 עם הסימונים'}),second=screen.getByRole('group',{name:'טקסט הערה במיקום 2 עם הסימונים'});const range=document.createRange();range.setStart(first.querySelector('mark')!.firstChild!,0);range.setEnd(second.querySelector('mark')!.firstChild!,3);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);fireEvent(document,new Event('selectionchange'));expect(button).toBeDisabled();selection.removeAllRanges();
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
describe('Word review choices and editing',()=>{
 it('an Israeli ruling list shows buttons; a choice sends exactly one new check for that ruling',async()=>{
  const options=[{label:'ע"פ 1/10 זדורוב נ\' מדינת ישראל (2015)',selection:'ע"פ 1/10 זדורוב נ\' מדינת ישראל (2015) <!--DATA:x-->'},{label:'דנ"פ 2/16 זדורוב נ\' מדינת ישראל (2016)',selection:'דנ"פ 2/16 זדורוב נ\' מדינת ישראל (2016) <!--DATA:y-->'}];
  mocks.run.mockResolvedValueOnce({citation:'',status:'warning',sourceType:'case_law_database',warningMsg:'נמצאו כמה פסקי דין אפשריים. בחרו את פסק הדין הנכון.',retryChoice:{kind:'israeli',options}});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();
  const second=await screen.findByRole('button',{name:/דנ"פ 2\/16/});
  mocks.run.mockResolvedValueOnce({citation:'Corrected',status:'valid',sourceType:'case_law_database'});
  fireEvent.click(second);await result();
  expect(mocks.run).toHaveBeenCalledTimes(2);expect(mocks.run.mock.calls[1][0]).toMatchObject({rawInput:options[1].selection,resultSelection:true,useVerifiedStore:false});
 });
 it('rulings from two countries: choosing England re-checks once with England chosen',async()=>{
  mocks.run.mockResolvedValueOnce({citation:'',status:'warning',sourceType:'foreign_case_other',warningMsg:'נדרשת בחירה בין כמה פסקי דין',retryChoice:{kind:'country',countries:[{country:'uk',options:[{label:'Donoghue v Stevenson [1932] UKHL 100',url:'https://www.bailii.org/x'}]},{country:'us',options:[{label:'Donoghue (US page)',url:'https://example.edu/y'}]}]}});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();
  const uk=await screen.findByRole('button',{name:'פסק דין מאנגליה'});
  fireEvent.click(uk);await result();
  expect(mocks.run).toHaveBeenCalledTimes(2);expect(mocks.run.mock.calls[1][0].manualChoice).toMatchObject({jurisdiction:'UK'});
 });
 it('the text to check can be edited and the empty proposal can be typed, then re-checked',async()=>{
  mocks.run.mockResolvedValueOnce({citation:'',status:'warning',sourceType:'book',warningMsg:'x'});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(1));
  const output=await screen.findByLabelText('התיקון המוצע לאזכור 1');await waitFor(()=>expect(output).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'✎ עריכת הנוסח לבדיקה'}));
  fireEvent.change(screen.getByLabelText('הנוסח לבדיקה לאזכור 1'),{target:{value:'Author, Better Title (2020)'}});
  mocks.run.mockResolvedValueOnce({citation:'Corrected',status:'valid',sourceType:'book'});
  fireEvent.click(screen.getByRole('button',{name:'בדוק את הנוסח הזה'}));await result();
  expect(mocks.run.mock.calls[1][0].rawInput).toBe('Author, Better Title (2020)');
 });
 it('Israeli case proposals offer the party check, which turns green when confirmed',async()=>{
  mocks.run.mockResolvedValueOnce({citation:'ע"א 1/20 כהן נ\' לוי (2020)',status:'valid',sourceType:'case_law_database'});
  render(<WordFootnoteWorkflow/>);await upload();review();generate();
  fireEvent.click(await screen.findByRole('button',{name:'👤 לחץ לבדיקת צדדים'}));
  fireEvent.click(screen.getByRole('button',{name:'✓ שמות הצדדים תקינים'}));
  expect(screen.getByRole('button',{name:'✓ שמות הצדדים תקינים'})).toBeInTheDocument();
 });
});
