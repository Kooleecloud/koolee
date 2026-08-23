import { createHash } from "node:crypto";

import {
  hasExtractedFields,
  MAX_TICKET_UPLOAD_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
  type TicketExtractor,
} from "@koolee/core";

import type { TicketPrefill } from "@/lib/booking-draft-schema";

/**
 * The ticket-upload pipeline, separated from the Next.js route handler so it
 * is testable with fakes: validate → store (PRIVATE bucket, server-side) →
 * record `ticket_uploads` row → extract synchronously (the customer is
 * waiting) → hand back a review-form PREFILL.
 *
 * Nothing returned here is persisted to booking fields — the caller writes
 * the prefill into the quarantined `ticketPrefill` cookie key, and only the
 * review form's confirmed values go further (see booking-draft-schema.ts).
 */

export const TICKET_BUCKET = "ticket-uploads";

export const UPLOAD_COPY = {
  tooLarge: "That file is too large — e-tickets are usually under 10 MB.",
  badType: "Upload a PDF — that's the format airlines email you.",
  missing: "Choose a PDF e-ticket to upload.",
  unreadable: "We couldn't read this — please enter your flight details manually.",
  storageFailed: "Something went wrong saving the file. Enter your flight manually.",
} as const;

export interface TicketUploadStorage {
  /** Must create/verify a PRIVATE bucket — never a public one. */
  ensureBucket(): Promise<void>;
  upload(path: string, data: Uint8Array, contentType: string): Promise<void>;
}

export interface TicketUploadDeps {
  draftId: string;
  extractor: TicketExtractor;
  storage: TicketUploadStorage;
  createUploadRow(input: {
    draftId: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }): Promise<{ id: string }>;
  setUploadStatus(input: {
    id: string;
    status: "extracted" | "unreadable" | "failed";
  }): Promise<void>;
}

export type TicketUploadOutcome =
  | { ok: true; uploadId: string; prefill: TicketPrefill }
  | { ok: false; status: number; error: string };

export async function handleTicketUpload(
  deps: TicketUploadDeps,
  file: { data: Uint8Array; mimeType: string; fileName?: string } | null,
): Promise<TicketUploadOutcome> {
  if (!file || file.data.byteLength === 0) {
    return { ok: false, status: 400, error: UPLOAD_COPY.missing };
  }
  if (file.data.byteLength > MAX_TICKET_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: UPLOAD_COPY.tooLarge };
  }
  if (!(TICKET_UPLOAD_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    return { ok: false, status: 415, error: UPLOAD_COPY.badType };
  }

  const checksum = createHash("sha256").update(file.data).digest("hex");
  const extension = file.mimeType === "application/pdf" ? "pdf" : "img";

  // Store first, then record — an orphaned object is recoverable garbage,
  // an orphaned row pointing at nothing is a lie.
  const uploadId = crypto.randomUUID();
  const storagePath = `tickets/${deps.draftId}/${uploadId}.${extension}`;
  try {
    await deps.storage.ensureBucket();
    await deps.storage.upload(storagePath, file.data, file.mimeType);
  } catch (error) {
    console.error("[ticket-upload] storage write failed", error);
    return { ok: false, status: 502, error: UPLOAD_COPY.storageFailed };
  }

  const row = await deps.createUploadRow({
    draftId: deps.draftId,
    storagePath,
    mimeType: file.mimeType,
    sizeBytes: file.data.byteLength,
    checksum,
  });

  // Synchronous extraction — the customer is on the flight step waiting.
  let outcome;
  try {
    outcome = await deps.extractor.extract({
      data: file.data,
      mimeType: file.mimeType,
      ...(file.fileName ? { fileName: file.fileName } : {}),
    });
  } catch (error) {
    // Extractors shouldn't throw, but a bug in one must not 500 the funnel.
    console.error("[ticket-upload] extractor threw", error);
    await deps.setUploadStatus({ id: row.id, status: "failed" });
    return { ok: false, status: 200, error: UPLOAD_COPY.unreadable };
  }

  if (outcome.status === "unreadable" || !hasExtractedFields(outcome.result)) {
    await deps.setUploadStatus({ id: row.id, status: "unreadable" });
    return { ok: false, status: 200, error: UPLOAD_COPY.unreadable };
  }

  await deps.setUploadStatus({ id: row.id, status: "extracted" });

  const result = outcome.result;
  const prefill: TicketPrefill = {
    ...(result.flightNumber ? { flightNumber: result.flightNumber } : {}),
    ...(result.airlineIata ? { airlineIata: result.airlineIata } : {}),
    ...(result.departureAirport ? { departureAirport: result.departureAirport } : {}),
    ...(result.departureAtLocal ? { departureAtLocal: result.departureAtLocal } : {}),
    ...(result.paxName ? { paxName: result.paxName } : {}),
    ...(result.scope ? { scope: result.scope } : {}),
    confidence: result.confidence,
    uploadId: row.id,
  };
  return { ok: true, uploadId: row.id, prefill };
}
