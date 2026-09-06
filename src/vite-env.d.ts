/// <reference types="vite/client" />

// Deno `npm:` specifiers used by edge-function modules that tests import.
declare module "npm:unpdf@0.12.1" {
  // deno-lint-ignore no-explicit-any
  export const extractText: any;
  // deno-lint-ignore no-explicit-any
  export const getDocumentProxy: any;
}
declare module "npm:mammoth@1.8.0" {
  // deno-lint-ignore no-explicit-any
  const mammoth: any;
  export default mammoth;
}
