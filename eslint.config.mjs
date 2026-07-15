// =============================================================================
// ESLINT CONFIG
// Raycast's shared config, plus the size/typing limits this project holds to.
// -----------------------------------------------------------------------------
// NOTE: The limits below are the authoritative enforcement of the conventions in
//   CONTRIBUTING.md — blank lines and comments are excluded, so a well-commented
//   file is never penalised. `test/` is CommonJS and is linted more loosely.
// =============================================================================

import { defineConfig, globalIgnores } from "eslint/config";
import raycastConfig from "@raycast/eslint-config";

export default defineConfig([
  globalIgnores([".test-build/", "swift/", "dist/"]),

  ...raycastConfig,

  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    files: ["test/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { require: "readonly", module: "readonly", process: "readonly", console: "readonly", __dirname: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
]);
