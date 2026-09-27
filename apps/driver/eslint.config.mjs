import reactConfig from "@koolee/config/eslint/react";

export default [
  { ignores: ["ios/**", "android/**", ".expo/**", "dist/**", "tailwind.tokens.js"] },
  ...reactConfig,
  {
    // React Native has no DOM; these are the globals Metro provides.
    languageOptions: { globals: { __DEV__: "readonly", fetch: "readonly", FormData: "readonly" } },
  },
];
