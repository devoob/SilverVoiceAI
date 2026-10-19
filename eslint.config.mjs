import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Age-friendly banking means accessibility is a build gate, not a review
  // afterthought. eslint-config-next already registers the jsx-a11y plugin
  // with a subset of its rules, so only the rule set is layered on here —
  // re-registering the plugin would be a config error (WCAG 2.1 AA is the
  // target in PRD 5).
  { rules: jsxA11y.flatConfigs.recommended.rules },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright runs in Node, not the browser.
    "e2e/**",
    "playwright.config.ts",
  ]),
]);

export default eslintConfig;
