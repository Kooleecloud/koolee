/**
 * The login flow shares the auth actions in `@/actions/auth` — one Turnstile
 * check, one result convention, one customer-row write path for the funnel
 * gate and returning sign-in alike. Re-exported here so the login module keeps
 * a local import surface.
 */
export { sendOtp, verifyOtp, sendMagicLink } from "@/actions/auth";
