import { describe,it,expect } from "vitest";
import JSZip from "jszip";
import { planWordFootnote,hasMultipleSourceSignals } from "./wordFootnotePlan";
import { inspectDocxFootnotes,embedApprovedFootnotes } from "./docxFootnoteRoundtrip";
const note = (text:string) => ({id:"42",text,editableRanges:[{start:0,end:text.length}],paragraphRanges:[{start:0,end:text.length}]});
describe("automatic Word candidate planning",()=>{
 it("sends full original input with no markings, retaining edge separators in the document",()=>{
  expect(planWordFootnote(note("  Author, Title (2020); "),[])).toEqual({kind:"candidate",start:2,end:22,input:"  Author, Title (2020); ",crossesRuns:false});
 });
 it("excludes one or multiple protected spans and preserves their original offsets",()=>{
  const n=note("explain; Author, Title (2020); ending");
  const plan=planWordFootnote(n,[{start:0,end:7},{start:30,end:n.text.length}]);
  expect(plan.kind).toBe("candidate"); if(plan.kind!=="candidate") throw Error();
  expect(plan.input).not.toContain("explain");expect(plan.input).not.toContain("ending");
  expect(n.text.slice(plan.start,plan.end)).toBe("Author, Title (2020)");
  expect(planWordFootnote(n,[{start:0,end:n.text.length}]).kind).toBe("protected");
 });
 it("does not concatenate separated unprotected pieces or guess multiple-source boundaries",()=>{
  expect(planWordFootnote(note("first explanation second"),[{start:6,end:17}]).kind).toBe("unresolved");
  for(const text of ["A (2020); B (2021)","A (2020), B (2021)","A\nB","case 123/20 and case 567/21","A. see also B"])
   expect(planWordFootnote(note(text),[]).kind,text).toBe("unresolved");
  expect(hasMultipleSourceSignals("Author, Title (2020)")).toBe(false);
 });
 it("validates protection geometry and keeps formatting consent explicit",()=>{
  const n=note("A😀B");for(const spans of [[{start:2,end:3}],[{start:0,end:3},{start:2,end:4}],[{start:-1,end:2}]])expect(()=>planWordFootnote(n,spans)).toThrow();
  expect(planWordFootnote({...n,editableRanges:[{start:0,end:1},{start:1,end:4}]},[])).toMatchObject({kind:"candidate",crossesRuns:true});
 });
 it("roundtrips protected prose/separators and every other ZIP entry exactly, including repeated exports",async()=>{
  const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",z=new JSZip();
  z.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("word/document.xml",`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>BODY</w:t><w:footnoteReference w:id="42"/></w:r></w:p></w:body></w:document>`);
  const text="explain; Author, Title (2020); ending",xml=`<w:footnotes xmlns:w="${W}"><w:footnote w:id="42"><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  z.file("word/footnotes.xml",xml);z.file("word/styles.xml","unchanged");
  const original=await z.generateAsync({type:"arraybuffer"}),copy=new Uint8Array(original).slice(),session=await inspectDocxFootnotes(original);
  const protectedSpans=[{id:"42",originalText:text,start:0,end:7},{id:"42",originalText:text,start:30,end:text.length}];
  const plan=planWordFootnote(session.notes[0],protectedSpans);if(plan.kind!=="candidate")throw Error();
  for(let i=0;i<2;i++){
   const output=await JSZip.loadAsync(await embedApprovedFootnotes(session,[{id:"42",originalText:text,...plan,replacement:"Corrected",approved:true}],protectedSpans));
   for(const name of Object.keys(z.files))if(name!=="word/footnotes.xml")expect(await output.files[name].async("uint8array")).toEqual(await z.files[name].async("uint8array"));
   expect(await output.file("word/footnotes.xml")!.async("string")).toBe(xml.replace("Author, Title (2020)","Corrected"));
  }
  expect(new Uint8Array(original)).toEqual(copy);
 });
});
