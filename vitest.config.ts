import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deno `npm:` specifiers used by edge functions are stubbed under test.
      "npm:unpdf@0.12.1": path.resolve(__dirname, "./src/test/stubs/npmEmpty.ts"),
      "npm:mammoth@1.8.0": path.resolve(__dirname, "./src/test/stubs/npmEmpty.ts"),
    },
  },
});
