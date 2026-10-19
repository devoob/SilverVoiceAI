import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // The domain layer is pure TypeScript with no DOM dependency, so Node is
    // the fastest and most faithful environment for it. UI behaviour is
    // covered end-to-end by Playwright instead.
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["default"],
  },
});
