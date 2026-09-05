// Test-only stub for Deno `npm:` specifiers that Vite cannot resolve.
export const extractText = async () => ({ text: "", totalPages: 0 });
export const getDocumentProxy = async () => ({ numPages: 0 });
export default { convertToHtml: async () => ({ value: "" }), extractRawText: async () => ({ value: "" }) };
