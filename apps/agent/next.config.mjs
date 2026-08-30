import path from "node:path";
import { fileURLToPath } from "node:url";

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

export default nextConfig;
