/**
 * Custom entry point.
 *
 * Order matters and Expo Router insists on being LAST. Everything that must
 * exist before any screen renders goes above it:
 *
 *  - the background location task. `TaskManager.defineTask` has to run at
 *    module scope of the bundle, because when iOS or Android wakes the app
 *    headlessly for a location batch no route file is ever evaluated;
 *  - Sentry, so a crash during that headless wake is still reported.
 */
import "./src/location/task";
import "./src/lib/sentry";
import "expo-router/entry";
