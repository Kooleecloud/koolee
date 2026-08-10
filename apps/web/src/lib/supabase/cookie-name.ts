/**
 * Per-app auth cookie name.
 *
 * @supabase/ssr defaults to `sb-<project-ref>-auth-token`, and all three
 * Koolee apps share one Supabase project. Browsers scope cookies by hostname
 * only (ports are ignored), so on localhost the web/agent/admin dev servers
 * share one cookie jar — with the default name, signing into one app
 * overwrites the others' sessions. A per-app name gives each app its own
 * cookie. No production impact: the apps deploy to separate hostnames, whose
 * cookies are host-only either way.
 *
 * Every client in THIS app (server, browser, proxy) must use the same name —
 * otherwise the proxy would refresh a cookie the server client never reads.
 * The agent and admin apps set their own names inline at their single
 * `createServerClient` call sites.
 */
export const AUTH_COOKIE_NAME = "sb-koolee-web-auth";
