/**
 * Product availability flags.
 *
 * These are PRODUCT AVAILABILITY switches, not authorization mechanisms.
 * No query-param backdoor, no localStorage override.
 *
 * Academic Writing is frozen for the public beta. All of its code, data and
 * schema stay intact; only availability is off. Internal/dev environments can
 * enable it by setting VITE_ACADEMIC_WRITING_ENABLED="true".
 */
export const ACADEMIC_WRITING_ENABLED: boolean =
  import.meta.env.VITE_ACADEMIC_WRITING_ENABLED === "true";
