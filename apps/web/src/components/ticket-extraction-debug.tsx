"use client";

import * as React from "react";

/**
 * The raw extraction payload, on the page, for whoever uploaded the ticket.
 *
 * Rendered only when the server says TICKET_EXTRACTION_DEBUG is on. Nothing
 * here is customer-facing copy: it is the whole diagnostics blob — every
 * segment the model read, which leg was chosen and why, the fields we
 * dropped, both attempts with their token usage — so a bad read can be
 * diagnosed from the browser instead of guessed at from an empty form.
 *
 * It lives in sessionStorage rather than the draft cookie: the payload is far
 * larger than a 4 KB cookie allows, and it must never travel with the booking.
 */

export const TICKET_DEBUG_KEY = "koolee:ticket-extraction-debug";
/** Fired by the uploader so this panel updates without a navigation. */
export const TICKET_DEBUG_EVENT = "koolee:ticket-extraction-debug";

export function TicketExtractionDebug() {
  const [payload, setPayload] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const read = () => {
      try {
        setPayload(sessionStorage.getItem(TICKET_DEBUG_KEY));
      } catch {
        // Private-mode browsers throw on storage access; the panel is optional.
        setPayload(null);
      }
    };
    read();
    window.addEventListener(TICKET_DEBUG_EVENT, read);
    return () => window.removeEventListener(TICKET_DEBUG_EVENT, read);
  }, []);

  if (!payload) return null;

  return (
    <details className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-slate-700">
        Extraction debug — what the model returned
      </summary>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1"
          onClick={() => {
            void navigator.clipboard?.writeText(payload).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1"
          onClick={() => {
            try {
              sessionStorage.removeItem(TICKET_DEBUG_KEY);
            } catch {
              /* nothing to clear */
            }
            setPayload(null);
          }}
        >
          Clear
        </button>
      </div>

      <pre className="mt-2 max-h-96 overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed text-slate-800">
        {payload}
      </pre>
    </details>
  );
}
