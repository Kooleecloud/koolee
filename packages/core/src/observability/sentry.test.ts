import { describe, expect, it } from "vitest";

import { SENTRY_LEVEL_BY_SEVERITY, SENTRY_TAGS, sentryOptions } from "./sentry";

describe("sentryOptions", () => {
  const base = {
    app: "web" as const,
    environment: "production",
    release: "abc123",
  };

  it("is disabled without a DSN, which is what a fresh clone runs", () => {
    const options = sentryOptions({ ...base, dsn: undefined });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it("is enabled with one", () => {
    expect(
      sentryOptions({ ...base, dsn: "https://k@o.ingest.sentry.io/1" }).enabled,
    ).toBe(true);
  });

  it("keeps PII off and tracing at zero", () => {
    // Both are policy, not defaults. `sendDefaultPii` would attach IPs,
    // cookies and headers to every event on a product that deliberately
    // stores no passport fields and hashes OTP destinations; tracing is the
    // expensive half of the bill and answers no question Koolee has.
    const options = sentryOptions({ ...base, dsn: "https://k@o.ingest.sentry.io/1" });
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });

  it("tags every event with the app it came from", () => {
    for (const app of ["web", "admin", "agent"] as const) {
      expect(sentryOptions({ ...base, app, dsn: undefined }).initialScope.tags).toEqual({
        [SENTRY_TAGS.app]: app,
      });
    }
  });

  it("never leaves an event untagged by environment", () => {
    // An untagged event in a shared project is one nobody can filter out.
    expect(
      sentryOptions({ ...base, environment: undefined, dsn: undefined }).environment,
    ).toBe("development");
  });

  it("passes the release through so an event names its commit", () => {
    expect(sentryOptions({ ...base, dsn: undefined }).release).toBe("abc123");
    expect(
      sentryOptions({ ...base, release: undefined, dsn: undefined }).release,
    ).toBeUndefined();
  });
});

describe("SENTRY_LEVEL_BY_SEVERITY", () => {
  it("keeps critical distinguishable from warning, so a page can be rung", () => {
    expect(SENTRY_LEVEL_BY_SEVERITY.critical).toBe("fatal");
    expect(SENTRY_LEVEL_BY_SEVERITY.warning).toBe("warning");
    expect(SENTRY_LEVEL_BY_SEVERITY.info).toBe("info");
  });
});
