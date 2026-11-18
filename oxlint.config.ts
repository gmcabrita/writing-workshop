import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";
import nkzwConfig from "@nkzw/oxlint-config/with-sorting";
import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
  },
  extends: [nkzwConfig, effectRecommended],
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "dist/**",
  ],
  overrides: [
    {
      // shadcn generated components. Kept close to upstream so they can be
      // re-added from the registry without manual edits.
      files: ["src/components/ui/**/*.tsx"],
      rules: {
        "import/no-namespace": "off",
        "perfectionist/sort-jsx-props": "off",
        "perfectionist/sort-objects": "off",
        "quality/no-object-parameters": "off",
      },
    },
  ],
  rules: {
    complexity: ["error", { max: 12 }],
  },
});
