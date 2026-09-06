import * as Sentry from "@sentry/nextjs";

/**
 * Next's server-side instrumentation hook — the SDK's entry point for the
 * Node and edge runtimes (`instrumentation-client.ts` is the browser's).
 *
 * `register()` runs once per runtime, before anything else in the app. The
 * imports are dynamic and inside the branch on purpose: the edge runtime
 * cannot load the Node SDK and vice versa, and a static import of either would
 * be bundled into both.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Errors thrown inside a React Server Component render, a route handler or a
 * server action. Without this hook they are logged by Next and recorded
 * nowhere — `error.tsx` is a CLIENT boundary and never sees the original.
 */
export const onRequestError = Sentry.captureRequestError;
