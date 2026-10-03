import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/.next/",
      "**/dist/",
      "**/coverage/",
      "packages-mount/",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ...nextPlugin.configs["core-web-vitals"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { next: { rootDir: "apps/web/" } },
  },
);
