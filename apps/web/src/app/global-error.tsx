"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * The LAST error boundary — the one that catches a failure in the root layout
 * itself, which `error.tsx` never sees because `error.tsx` renders inside that
 * layout.
 *
 * It therefore has to render its own `<html>` and `<body>`, and it cannot use
 * anything from the layout: no fonts, no theme, no `@koolee/ui` chrome. That
 * constraint is why the markup below is plain and inline-styled rather than
 * Tailwind — the stylesheet is part of what may have failed.
 *
 * The three apps' `error.tsx` files were already one `captureException` away
 * from instrumented; the missing piece was this root boundary, and it was
 * missing in all three (Tier 5 pre-flight §2.3).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          color: "#0f172a",
          background: "#f8fafc",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#475569", lineHeight: 1.6 }}>
            Your booking is safe. Reload the page, or come back in a moment — we have been
            told.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              padding: "0.625rem 1.25rem",
              fontSize: "0.9375rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
