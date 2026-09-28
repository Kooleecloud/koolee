import { defineConfig } from "vitest/config";

/**
 * Pure logic only — job grouping, the queue's ordering rules, the API client's
 * response parsing, the token script. Anything that imports react-native or an
 * expo module is exercised on the simulators, not here.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
