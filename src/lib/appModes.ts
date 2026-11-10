/**
 * Which top-level tabs a user may open on /app.
 * The legal assistant ("העוזר המשפטי") is not part of the first public
 * version: only admins see it; everyone else lands on the uniform citation tab.
 */
export type AppMode = "freetext" | "batch" | "bibliography" | "legalqa";

export const DEFAULT_APP_MODE: AppMode = "freetext";

const PUBLIC_MODES: AppMode[] = ["freetext", "batch", "bibliography"];

/** Tabs shown in the header, in display order. */
export function visibleAppModes(isAdmin: boolean): AppMode[] {
  return isAdmin ? ["legalqa", ...PUBLIC_MODES] : PUBLIC_MODES;
}

/** The tab actually rendered: a non-admin can never end up on the legal assistant. */
export function effectiveAppMode(mode: AppMode, isAdmin: boolean): AppMode {
  return visibleAppModes(isAdmin).includes(mode) ? mode : DEFAULT_APP_MODE;
}

/** Deep links that belong to the legal assistant (conversation, job reattach, /legal-qa redirect). */
export function isLegalAssistantLink(conversationId: string | undefined, search: string): boolean {
  if (conversationId) return true;
  const params = new URLSearchParams(search);
  return params.get("mode") === "legalqa" || params.has("job");
}
