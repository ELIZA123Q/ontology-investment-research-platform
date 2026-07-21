import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["adapters/**/*.ts", "engine/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.test.ts", ".next/**"],
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
