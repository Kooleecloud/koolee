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
  {
    // The extraction adapters: pdf libraries only in heuristic/, the
    // Anthropic SDK only in claude/. Same boundary idea as Stripe.
    files: ["src/extraction/heuristic/**/*.ts", "src/extraction/claude/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
