import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
