import { describe, it, expect } from "vitest";
import { extractBookPublicationEvidence as extract } from "../../supabase/functions/_shared/citationPure/bookPublicationEvidence";
describe("title bound publication evidence",()=> {
 it("accepts direct year, edition and publisher metadata",()=>{expect(extract("Smith, National Identity (1991)","National Identity")).toEqual({year:"1991"});expect(extract("National Identity (2nd ed. 1993)","National Identity")).toEqual({year:"1993",edition:"2nd ed."});expect(extract("National Identity. Publication year: 1991","National Identity")).toEqual({year:"1991"});});
 it("does not borrow review or another work dates",()=>{expect(extract("National Identity by Smith. Other Work (1999)","National Identity")).toEqual({}); expect(extract("National Identity. Reviewed in 1999", "National Identity")).toEqual({});});
 it("supports subtitles and declines mixed years",()=>{expect(extract("National Identity: A Study of Nations (1991)","National Identity")).toEqual({year:"1991"});expect(extract("National Identity (1991). National Identity (1993)","National Identity")).toEqual({});});
});
