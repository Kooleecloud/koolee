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
  {
    // The timezone formatters themselves. This is the ONE module allowed to
    // call date-fns `format` and construct `Intl.DateTimeFormat` — everywhere
    // else must come through its exported functions, which demand an explicit
    // zone. See the rule's rationale in @koolee/config/eslint/base.
    files: ["src/slots/cutoff.ts", "src/slots/cutoff.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
