import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Tests never call a paid API: the scripted assistant answers instead.
    env: { CARELOOP_AI: "sample" },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
});
