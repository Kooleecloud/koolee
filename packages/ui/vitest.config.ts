import { defineConfig } from "vitest/config";

/**
 * `packages/ui` is mostly React components, which are exercised through the
 * apps and Storybook. This config exists for the parts that are pure logic and
 * must not drift — today that is `lib/agreement-markdown.ts`, where the editor
 * and the customer-facing renderer have to agree exactly.
 *
 * `.tsx` IS INCLUDED NOW (slice F4), and the environment is still `node`.
 * That is not a contradiction: `react-dom/server`'s `renderToStaticMarkup`
 * needs no DOM, so a component with no hooks and no browser APIs can be
 * rendered here exactly as a React Server Component renders it — which is
 * both a test of its OUTPUT and a test that it is server-safe at all. A
 * component that reached for `useState` would throw here, which is the very
 * failure `client-directive.test.ts` exists to catch statically.
 *
 * This is NOT the DOM harness P20 asks for. Nothing here can click, type or
 * fire a blur, and the date-field regression that motivated P20 would still
 * pass. Static output only.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
