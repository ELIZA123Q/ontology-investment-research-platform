import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/runtime/**/*.ts", "src/providers/**/*.ts", "src/research/**/*.ts", "src/security/**/*.ts"],
      exclude: ["src/**/generated/**", "src/runtime/worker*.ts"],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 85,
        lines: 88,
      },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
