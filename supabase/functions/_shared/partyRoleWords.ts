// Procedural role words ("העותרים", "המשיב", …) that the model falls back to
// when it cannot read a caption. They are not party names and must render as
// [חסר: …]. Anonymized names such as "פלוני"/"אלמוני" are real, court-mandated
// party names and are NOT role words: they go through the same source
// grounding as any other party name.
const ROLE_WORDS = /^(?:ה?עותר(?:ים|ת)?|ה?משיב(?:ים|ה)?|ה?מערער(?:ים|ת)?|ה?מבקש(?:ים|ת)?|ה?נאשם|ה?נאשמים|ה?תובע(?:ים|ת)?|ה?נתבע(?:ים|ת)?|צד א|צד ב)$/;

export function isRoleWordParty(value: unknown): boolean {
  return typeof value === "string" && ROLE_WORDS.test(value.trim());
}
