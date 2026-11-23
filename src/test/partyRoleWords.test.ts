import { describe, it, expect } from "vitest";
import { isRoleWordParty } from "../../supabase/functions/_shared/partyRoleWords";

describe("party role words", () => {
  it.each(["פלוני", "אלמוני", "פלונית", "אלמונית"])("accepts anonymized party name %s", (name) => {
    expect(isRoleWordParty(name)).toBe(false);
  });
  it.each(["העותרים", "המשיב", "המערערת", "הנאשם", "צד א"])("still rejects procedural role %s", (role) => {
    expect(isRoleWordParty(role)).toBe(true);
  });
});
