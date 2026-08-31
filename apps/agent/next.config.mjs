import path from "node:path";
import { fileURLToPath } from "node:url";

import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        /*
         * The push service worker.
         *
         * `no-cache` because a stale `sw.js` is the single most expensive
         * thing to debug here: the browser keeps serving the old worker,
         * every change appears to do nothing, and nothing anywhere reports
         * that a cached version is in play.
         *
         * `Service-Worker-Allowed: /` lets it claim the root scope, which it
         * needs in order to be woken for the whole app rather than only for
         * `/` itself.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@koolee/ui", "@koolee/core", "@koolee/db"],
  // Without this, Next guesses the wrong root in a pnpm monorepo.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    optimizePackageImports: ["@koolee/ui", "lucide-react"],
    serverActions: {
      // Bag photos are downscaled in the browser (src/lib/photo.ts) to well
      // under 1 MB. This is only the safety net for browsers where the canvas
      // re-encode fails and the raw camera capture is sent. Kept under
      // Vercel's ~4.5 MB serverless request body cap, which this cannot raise.
      bodySizeLimit: "4mb",
    },
  },
};

/*
 * Sentry wraps the config LAST, and the object above is handed to it
 * untouched.
 *
 * ⚠️ THE RISK THIS LINE CARRIES. `headers()` above is the only reason web push
 * works: `/sw.js` must be served `no-cache` (a stale worker is the single most
 * expensive thing to debug here — every change appears to do nothing) with
 * `Service-Worker-Allowed: /`. `withSentryConfig` composes rather than
 * replaces, so the rule survives; the failure mode if it ever did not would be
 * SILENT. The build gate for it is the assertion in
 * `scripts/check-sw-headers.mjs`, run after every build of an app that ships a
 * service worker.
 *
 * Everything here is build-time only. Source maps upload when
 * SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT are all present (CI and
 * Vercel); on a laptop the step is skipped and `silent` keeps it from saying
 * so on every build.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Upload the maps, then delete them from the deployment: a public
  // `.js.map` hands the whole client source to anyone who asks for it.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Routes browser events through the app's own origin, so an ad blocker that
  // blocks `sentry.io` does not silently take client-side error reporting with
  // it. It is a Next rewrite, not a proxy we maintain.
  tunnelRoute: true,
  // Deliberately NOT set: `disableLogger` and `automaticVercelMonitors` are
  // both deprecated in SDK 10 in favour of a `webpack.*` namespace, and these
  // apps build with Turbopack. The first is a small bundle saving and the
  // second instruments Vercel's own cron runner, which Koolee does not use —
  // Inngest owns the four crons. Neither is worth a deprecation warning on
  // every build.
});
