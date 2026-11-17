import path from "node:path";
import { defineConfig } from "vitest/config";

// The live AI eval: calls the real Claude API with the key in .env.local, so it costs money.
// Run on purpose only: npm run eval:ai
export default defineConfig({
  test: {
    include: ["tests/**/*.eval.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
});
