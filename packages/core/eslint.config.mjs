import baseConfig from "@koolee/config/eslint/base";

export default [
  ...baseConfig,
  {
    // The one place the Stripe SDK is allowed. Everywhere else, the
    // no-restricted-imports rule from the base config applies.
    files: ["src/payments/stripe/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
