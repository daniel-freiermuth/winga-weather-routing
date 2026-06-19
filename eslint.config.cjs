const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // index.ts has many `any` at framework boundaries: Express req/res flush,
    // SignalK app object, catch (e: any), schema migration. These are accepted.
    files: ["src/index.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Test files use `any` for error type narrowing and mock objects.
    files: ["src/lib/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "data/", "claudisms/", ".opencode/"],
  },
);
