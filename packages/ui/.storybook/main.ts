import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  /*
   * MapLibre's tile-parsing worker, served at the same path the apps serve it
   * from (`/maplibre/…`), so `LiveMap` needs no Storybook-specific prop.
   *
   * `../public` is populated by `scripts/copy-maplibre-worker.mjs`, which the
   * `storybook` and `build-storybook` scripts run first. It is gitignored;
   * see that script's header for why the worker cannot simply be imported.
   */
  staticDirs: ["../public"],
  async viteFinal(viteConfig) {
    const tailwindcss = (await import("@tailwindcss/vite")).default;
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];

    /*
     * MapLibre must NOT go through Vite's dependency pre-bundling.
     *
     * TWO SEPARATE BUGS HAVE LIVED HERE, and they produce the identical
     * symptom — an empty cream rectangle with working zoom buttons, no
     * `error` event, and a style, sprite and TileJSON that all fetch 200.
     * Both are worker-loading failures; neither reports anything.
     *
     *  1. THIS ONE. The optimizer rewrites the worker import to a path it
     *     never emits: `sb-vite/deps/maplibre-gl-worker.mjs` 404s. Storybook
     *     adds every dep a story reaches to `include`, and a package in both
     *     lists stays optimized — so it has to come OUT of include as well as
     *     go into exclude.
     *
     *  2. The one that also broke the real apps, fixed in
     *     `scripts/copy-maplibre-worker.mjs` and `live-map.tsx`: maplibre-gl 6
     *     derives its worker URL from `import.meta.url` and returns the EMPTY
     *     STRING under any bundler, then constructs `new Worker("")`. Since
     *     `setWorkerUrl` now points at `/maplibre/…` unconditionally, that fix
     *     covers Storybook too — via `staticDirs` above.
     *
     * Both were found by SCREENSHOTTING a story. Typecheck, lint and the Next
     * production build were green over each of them.
     */
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      include: (viteConfig.optimizeDeps?.include ?? []).filter(
        (dep) => dep !== "maplibre-gl" && !dep.startsWith("maplibre-gl/"),
      ),
      exclude: [...(viteConfig.optimizeDeps?.exclude ?? []), "maplibre-gl"],
    };
    return viteConfig;
  },
};

export default config;
