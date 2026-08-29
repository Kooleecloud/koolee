import { defineConfig } from "vitest/config";

/**
 * `packages/ui` is mostly React components, which are exercised through the
 * apps and Storybook. This config exists for the parts that are pure logic and
 * must not drift — today that is `lib/agreement-markdown.ts`, where the editor
 * and the customer-facing renderer have to agree exactly.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
