import js from "@eslint/js";
import globals from "globals";

/** @type {Array<import("eslint").Linter.Config>} */
const sharedRules = {
  rules: {
    curly: "error",
    eqeqeq: "error",
    "no-console": "error",
    "no-shadow": "error",
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" }
    ],
    "no-var": "error",
    "prefer-const": "error"
  }
};

/** @type {Array<import("eslint").Linter.Config>} */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.browser,
        chrome: "readonly"
      }
    },
    ...sharedRules
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    ...sharedRules
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    ...sharedRules
  }
];
