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
  ],
  patterns: [
    {
      group: ["stripe/*"],
      message:
        "Import the Stripe SDK only inside packages/core/src/payments/stripe/. Elsewhere, depend on the PaymentProvider interface from @koolee/core.",
    },
  ],
};

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
    files: [
      "**/*.config.{js,mjs,cjs,ts}",
      "**/*.setup.{js,mjs,cjs,ts}",
      "**/*.cjs",
    ],
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
