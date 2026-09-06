import * as Sentry from "@sentry/nextjs";

import { options } from "@/lib/sentry";

/**
 * The browser. Next 16 loads this before any application code, which is what
 * makes it able to catch an error thrown during hydration.
 */
Sentry.init(options());

/**
 * Navigation timing. Harmless with `tracesSampleRate: 0` — it exists so that
 * turning tracing on later is one number rather than a hunt for this hook.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
