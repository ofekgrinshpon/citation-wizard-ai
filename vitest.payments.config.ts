import { defineConfig } from "vitest/config";

// Server/payment tests run without browser-only setup or live services.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/citationPassLedger.test.ts", "src/test/takbullPagePayment.test.ts", "src/test/takbullPageSettlement.test.ts", "src/test/citationPassCheckout.test.ts"],
  },
});