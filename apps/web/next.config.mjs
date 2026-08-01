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
  eslint: {
    // Linting is its own turbo task (`pnpm lint`) using the shared flat config
    // from @koolee/config. Running it again inside `next build` would use
    // Next's own resolution and duplicate the work.
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ["@koolee/ui", "lucide-react"],
  },
};

export default nextConfig;
