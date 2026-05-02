import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["dotenv/config"],
    globalSetup: ["./test/e2e/globalSetup.ts"],
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
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "external/",
      ],
    },
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
});
