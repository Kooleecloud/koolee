// Sentry's helper wraps expo/metro-config (source maps + debug ids); NativeWind
// wraps the result to compile global.css. Expo configures the pnpm monorepo
// (watch folders, node_modules paths) by itself since SDK 52 — nothing manual.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

const config = getSentryExpoConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
