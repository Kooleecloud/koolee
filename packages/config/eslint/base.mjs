import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Architectural boundaries enforced as lint rules.
 *
 * - `stripe` may only be imported inside packages/core/src/payments/stripe/**.
 *   Everything else must go through the `PaymentProvider` interface.
 * - Apps must not import `@koolee/db` directly; all data access flows through
 *   `@koolee/core`. (Overridden back on for packages/db itself.)
 */
export const restrictedImports = {
  paths: [
    {
      name: "stripe",
      message:
        "Import the Stripe SDK only inside packages/core/src/payments/stripe/. Elsewhere, depend on the PaymentProvider interface from @koolee/core.",
    },
    {
      name: "unpdf",
      message:
        "Import pdf libraries only inside packages/core/src/extraction/heuristic/. Elsewhere, depend on the TicketExtractor interface from @koolee/core.",
    },
    {
      name: "@anthropic-ai/sdk",
      message:
        "Import the Anthropic SDK only inside packages/core/src/extraction/claude/. Elsewhere, depend on the TicketExtractor interface from @koolee/core.",
    },
  ],
  patterns: [
    {
      group: ["stripe/*"],
      message:
        "Import the Stripe SDK only inside packages/core/src/payments/stripe/. Elsewhere, depend on the PaymentProvider interface from @koolee/core.",
    },
    {
      group: ["@anthropic-ai/sdk/*"],
      message:
        "Import the Anthropic SDK only inside packages/core/src/extraction/claude/. Elsewhere, depend on the TicketExtractor interface from @koolee/core.",
    },
  ],
};

/**
 * Timezone rendering, enforced rather than documented.
 *
 * Koolee's rule is that every human-facing time is rendered in the BOOKING's
 * zone — the departure airport's — so the customer who buys a window, the
 * agent who shows up for it, and the dispatcher who plans around it all read
 * the same string. The failure mode is silent: `toLocaleString()` and bare
 * date-fns `format()` fall back to the SYSTEM zone, which is UTC in
 * production, so a booking renders 4–5 hours off with no error anywhere.
 *
 * Everything must therefore go through the formatters in
 * packages/core/src/slots/cutoff.ts, which take an explicit `tz`. That module
 * (and the two client components that deliberately render viewer-local time)
 * turn this rule off for themselves.
 *
 * See docs/TIME.md.
 */
export const restrictedTimeFormatting = [
  {
    selector:
      "CallExpression > MemberExpression[property.name=/^toLocale(String|TimeString|DateString)$/]",
    message:
      "toLocale* renders in the SYSTEM zone (UTC in production). Use the airport-tz formatters from @koolee/core — formatInstantInAirportTz, formatWindowInAirportTz, formatHourRangeInAirportTz — which require an explicit zone. See docs/TIME.md.",
  },
  {
    selector:
      "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Constructing Intl.DateTimeFormat directly bypasses the timezone policy. Use the formatters from @koolee/core, or add an eslint-disable with a comment saying why this render is viewer-local. See docs/TIME.md.",
  },
  {
    selector: "CallExpression[callee.name='format'][arguments.length=2]",
    message:
      "Bare date-fns format() uses the SYSTEM zone (UTC in production). Use formatInstantInAirportTz / formatWindowInAirportTz / formatHourRangeInAirportTz from @koolee/core, which take the booking's zone. For elapsed time, formatDistanceToNow needs no zone. See docs/TIME.md.",
  },
];

/** Files that never need linting. */
export const ignores = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/drizzle/**",
    "**/next-env.d.ts",
    "**/public/sw.js",
    // MapLibre's worker, copied out of node_modules by
    // scripts/copy-maplibre-worker.mjs. Minified vendor build output that
    // happens to land under `public/`, where nothing else is ignored by
    // extension — 1,228 errors' worth on the first run.
    "**/public/maplibre/**",
    "**/*.tsbuildinfo",
  ],
};

/** @type {import("eslint").Linter.Config[]} */
export const baseConfig = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "no-restricted-imports": ["error", restrictedImports],
      "no-restricted-syntax": ["error", ...restrictedTimeFormatting],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
  {
    // Tooling config consumed by CommonJS loaders (Tailwind, PostCSS) has to
    // stay CJS, so `require()` is legitimate here.
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/*.setup.{js,mjs,cjs,ts}", "**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node, module: "writable", require: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];

export default baseConfig;
