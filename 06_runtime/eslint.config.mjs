import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const defectRules = {
  "no-constant-binary-expression": "error",
  "no-debugger": "error",
  "no-duplicate-case": "error",
  "no-dupe-else-if": "error",
  "no-unsafe-finally": "error",
  "no-unreachable": "error",
};

export default [
  {
    ignores: [
      ".data/**",
      ".next/**",
      "coverage/**",
      "node_modules/**",
      "connectors/**/.venv/**",
      "src/**/generated/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...defectRules,
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-namespace": "error",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: defectRules,
  },
];
