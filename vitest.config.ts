import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["dotenv/config"],
    watch: false,
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: ["**/node_modules/**", "**/dist/**", "**/external/**"],
    typecheck: {
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "external/",
      ],
      // Enforce coverage on the deterministic semantic modules that have tests.
      thresholds: {
        "src/semantic/bm25.ts": { lines: 85, functions: 85, statements: 85, branches: 70 },
        "src/semantic/temporal.ts": { lines: 80, functions: 90, statements: 80, branches: 70 },
        "src/semantic/document.ts": { lines: 90, functions: 90, statements: 90, branches: 65 },
        "src/semantic/store.ts": { lines: 85, functions: 85, statements: 85, branches: 50 },
      },
    },
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
});
