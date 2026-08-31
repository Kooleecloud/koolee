"use client";

import * as React from "react";

/**
 * Opens the print dialog once, on arrival.
 *
 * ONCE, and that is the whole subtlety. The customer got here by clicking
 * "Download as PDF", so the dialog is what they asked for — but this page is
 * also perfectly readable on screen, and somebody who cancels the dialog to
 * read it must not have it thrown at them again on the next render. A ref
 * guard rather than an empty dependency array: React 19 in strict mode invokes
 * effects twice in development, and two print dialogs is a memorable bug.
 *
 * The timeout lets the fonts and the markdown settle first; printing mid-paint
 * produces a PDF with fallback type in it.
 */
export function PrintOnLoad() {
  const printed = React.useRef(false);

  React.useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
