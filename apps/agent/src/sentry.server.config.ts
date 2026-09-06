import * as Sentry from "@sentry/nextjs";

import { options } from "@/lib/sentry";

/** The Node runtime. Loaded by `instrumentation.ts`, never imported directly. */
Sentry.init(options());
