import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  async viteFinal(viteConfig) {
    const tailwindcss = (await import("@tailwindcss/vite")).default;
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];

    /*
     * MapLibre must NOT go through Vite's dependency pre-bundling.
     *
     * It loads its tile-parsing Web Worker from a sibling file, and the
     * optimizer rewrites the import to a path it never emits:
     * `sb-vite/deps/maplibre-gl-worker.mjs` 404s. The failure is completely
     * SILENT — the style, the sprites and the TileJSON all fetch fine, the
     * canvas mounts at the right size, MapLibre raises no `error` event, and
     * the map simply never requests a vector tile or fires `load`. What you
     * see is an empty cream rectangle with working zoom buttons.
     *
     * Found by screenshotting the story, not by any check that passes or
     * fails on its own: typecheck, lint and the Next production build were all
     * green over it. The apps are unaffected — this is Vite's optimizer, and
     * they bundle with Turbopack.
     */
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      // Storybook adds every dep a story reaches to `include`, and a package
      // that is in both lists stays optimized — so it has to come OUT of
      // include as well as go into exclude.
      include: (viteConfig.optimizeDeps?.include ?? []).filter(
        (dep) => dep !== "maplibre-gl" && !dep.startsWith("maplibre-gl/"),
      ),
      exclude: [...(viteConfig.optimizeDeps?.exclude ?? []), "maplibre-gl"],
    };
    return viteConfig;
  },
};

export default config;
