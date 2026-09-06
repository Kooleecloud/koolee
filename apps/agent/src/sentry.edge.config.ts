import * as Sentry from "@sentry/nextjs";

import { options } from "@/lib/sentry";

/**
 * The edge runtime — middleware and any route pinned to it.
 *
 * `apps/web`'s `proxy.ts` (Next 16's renamed middleware) runs here, so an
 * error in the auth redirect logic would otherwise go unrecorded.
 */
Sentry.init(options());
