import { describe,it,expect,vi } from "vitest";
import { evaluateBookEvidence,projectBookEvidence,publicBookText,bookEvidenceEnabled,authorizeBookEvidence } from "../../supabase/functions/citation-chat/bookEvidenceRoute";
import { createCitationBudget,FREEFORM_PARSER_MODEL_ID } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";
const text="National Identity by Anthony D. Smith. Publication date 1991. ISBN 9780140125658.";
const packet={title:"National Identity",author:"Anthony D. Smith",sources:[{id:"s0",text}]};
const record={sourceId:"s0",quote:text,title:packet.title,author:packet.author,year:"1991",isbn:"9780140125658",kind:"publication"};
describe("book evidence isolated server route",()=>{
it("requires existing retention gate and respects pilot kill switch",()=>{
 expect(bookEvidenceEnabled({})).toBe(false);
 expect(bookEvidenceEnabled({FREEFORM_PARSER_LIVE:"1",FREEFORM_PARSER_MODEL:FREEFORM_PARSER_MODEL_ID}, Date.parse("2026-11-19T12:00:00Z"))).toBe(false);
 expect(bookEvidenceEnabled({FREEFORM_PARSER_LIVE:"1",FREEFORM_PARSER_MODEL:FREEFORM_PARSER_MODEL_ID}, Date.parse("2026-11-18T12:00:00Z"))).toBe(true);
 expect(bookEvidenceEnabled({BOOK_EVIDENCE_MODEL_LIVE:"off",FREEFORM_PARSER_LIVE:"1",FREEFORM_PARSER_MODEL:FREEFORM_PARSER_MODEL_ID}, Date.parse("2026-11-18T12:00:00Z"))).toBe(false);
 expect(bookEvidenceEnabled({BOOK_EVIDENCE_MODEL_LIVE:"admin",FREEFORM_PARSER_LIVE:"1",FREEFORM_PARSER_MODEL:FREEFORM_PARSER_MODEL_ID}, Date.parse("2026-11-18T12:00:00Z"))).toBe(true);
 expect(bookEvidenceEnabled({BOOK_EVIDENCE_MODEL_LIVE:"1",FREEFORM_PARSER_LIVE:"1",FREEFORM_PARSER_MODEL:FREEFORM_PARSER_MODEL_ID}, Date.parse("2026-11-18T12:00:00Z"))).toBe(false);
});
it("fails closed when role check fails",async()=>{expect(await authorizeBookEvidence(async()=>false)).toBe(false);expect(await authorizeBookEvidence(async()=>{throw Error();})).toBe(false);});
it("sends source-only data once, charges shared model budget, no tools",async()=>{
 const budget=createCitationBudget(); const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({records:[record]})}}]})));
 const result=await evaluateBookEvidence({...packet,title:"PRIVATE_TARGET_SENTINEL"}, {apiKey:"test",budget,fetchImpl:fetchImpl as typeof fetch});
 expect(result).toEqual([record]);expect(budget.modelCalls).toBe(1);expect(fetchImpl).toHaveBeenCalledTimes(1);
 const body=JSON.parse(fetchImpl.mock.calls[0][1].body as string);expect(JSON.stringify(body)).not.toContain("PRIVATE_TARGET_SENTINEL");expect(body.tools).toBeUndefined();expect(body.max_tokens).toBe(2400);
});
it("does not send after budget exhausted/unknown",async()=>{
 const fetchImpl=vi.fn();const budget={...createCitationBudget(),modelCalls:2};
 expect(await evaluateBookEvidence(packet,{apiKey:"test",budget,fetchImpl})).toBeNull();expect(fetchImpl).not.toHaveBeenCalled();
});
it("deadline marks shared budget unknown and never retries",async()=>{
 vi.useFakeTimers();
 try {
   const budget=createCitationBudget();const fetchImpl=vi.fn(()=>new Promise<Response>(()=>{}));
   const pending=evaluateBookEvidence(packet,{apiKey:"test",budget,fetchImpl});
   await vi.advanceTimersByTimeAsync(12000);
   expect(await pending).toBeNull();expect(budget.unknown).toBe(true);expect(fetchImpl).toHaveBeenCalledTimes(1);
 } finally {vi.useRealTimers();}
});
it("rejects oversized model output and truncated completions",async()=>{
 for(const payload of ["x".repeat(33000),JSON.stringify({choices:[{finish_reason:"length",message:{content:"{}"}}]})]) {
   const budget=createCitationBudget();const fetchImpl=vi.fn(async()=>new Response(payload));
   expect(await evaluateBookEvidence(packet,{apiKey:"test",budget,fetchImpl})).toBeNull();
   expect(fetchImpl).toHaveBeenCalledTimes(1);
 }
});
it("quarantines fabricated quote and projects original quotes",()=>{
 expect(projectBookEvidence(packet,[{...record,quote:"fabricated"}],[{id:"s0",url:"https://press.example.edu/book"}]).records).toHaveLength(0);
 expect(projectBookEvidence(packet,[record],[{id:"s0",url:"https://press.example.edu/book"}]).sources[0].text).toBe(text);
});
it("model branch stays terminal, search bounded, no fields guessed",async()=>{
 const budget=createCitationBudget();const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({results:[{title:"National Identity by Anthony D. Smith",url:"https://press.example.edu/book",snippet:text}]})));
 const evaluate=vi.fn(async()=>[record]);
 const result=await runForeignLookup({kind:"book",jurisdiction:"OTHER",rawInput:"National Identity by Anthony D. Smith",parsedFields:{bookTitle:packet.title,authors:packet.author}},{apiKey:"test",budget,fetchImpl:fetchImpl as typeof fetch,evaluateBookEvidence:evaluate});
 expect(evaluate).toHaveBeenCalledTimes(1);expect(result.bookModelEvidence?.records).toHaveLength(1);expect(result.fields).toEqual({});expect(budget.retrievals).toBeLessThanOrEqual(2);
});
it("supplied year never enters model branch",async()=>{
 const evaluate=vi.fn();const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({results:[]})));
 await runForeignLookup({kind:"book",jurisdiction:"OTHER",rawInput:"National Identity by Anthony D. Smith (1991)",parsedFields:{bookTitle:packet.title,authors:packet.author,year:"1991"}},{apiKey:"test",fetchImpl:fetchImpl as typeof fetch,evaluateBookEvidence:evaluate});
 expect(evaluate).not.toHaveBeenCalled();
});
});

it("strips executable HTML and rejects binary/PDF",()=>{
 expect(publicBookText("<html><head><script>SECRET()</script></head><body><p>"+text+"</p><script>bad()</script></body></html>")).toBe(text);
 expect(publicBookText("%PDF-1.7 binary")).toBeNull();
 expect(publicBookText("<script>junk never closed")).toBeNull();
});
