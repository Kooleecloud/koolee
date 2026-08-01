import nextPlugin from "@next/eslint-plugin-next";

import { reactConfig } from "./react.mjs";

/**
 * Next.js app config.
 *
 * Apps are thin adapters: no business logic, and no direct @koolee/db imports.
 * Domain logic and data access live in @koolee/core / @koolee/db respectively.
 */
/** @type {import("eslint").Linter.Config[]} */
export const nextConfig = [
  ...reactConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "stripe",
              message:
                "Import the Stripe SDK only inside packages/core/src/payments/stripe/.",
            },
            {
              name: "@koolee/db",
              message:
                "Apps must not query the database directly. Go through a @koolee/core service.",
            },
          ],
          patterns: [
            {
              group: ["stripe/*", "@koolee/db/*"],
              message:
                "Apps are thin adapters — use @koolee/core for domain logic and data access.",
            },
          ],
        },
      ],
    },
  },
];

export default nextConfig;
