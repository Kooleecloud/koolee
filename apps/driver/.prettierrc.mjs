// The repo-wide config, unchanged. A nested file exists only so an editor
// opened at apps/driver finds one; the Tailwind class-sorting plugin is NOT
// used because the root `pnpm format:check` runs from the workspace root,
// where a plugin that lives only in this app's node_modules cannot load.
export { default } from "@koolee/config/prettier";
