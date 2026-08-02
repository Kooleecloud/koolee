import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/** Max upload we'll parse — an e-ticket is a page or two. */
export const MAX_TICKET_PDF_BYTES = 5 * 1024 * 1024;

/**
 * Extracts the text layer of a PDF. Scanned (image-only) tickets come back as
 * an empty string — the caller treats that as "couldn't read it" and the
 * customer types the flight in manually.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
