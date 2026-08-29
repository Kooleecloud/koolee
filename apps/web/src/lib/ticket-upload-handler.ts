import { createHash } from "node:crypto";

import {
  deriveScope,
  hasExtractedFields,
  BUCKETS,
  MAX_TICKET_UPLOAD_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
  type ExtractedSegment,
  type TicketExtractionDiagnostics,
  type TicketExtractor,
} from "@koolee/core";

import {
  AIRPORT_CODES,
  type PrefillAlternative,
  type TicketPrefill,
} from "@/lib/booking-draft-schema";

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

export const TICKET_BUCKET = BUCKETS.ticketUploads.id;

export const UPLOAD_COPY = {
  tooLarge: "That file is too large — e-tickets are usually under 10 MB.",
  badType: "Upload a PDF — that's the format airlines email you.",
  missing: "Choose a PDF e-ticket to upload.",
  unreadable: "We couldn't read this — please enter your flight details manually.",
  storageFailed: "Something went wrong saving the file. Enter your flight manually.",
} as const;

export interface TicketUploadStorage {
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
  | {
      ok: true;
      uploadId: string;
      prefill: TicketPrefill;
      diagnostics?: TicketExtractionDiagnostics;
    }
  | {
      ok: false;
      status: number;
      error: string;
      diagnostics?: TicketExtractionDiagnostics;
    };

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
    // Nothing ensures the bucket here: `ticket-uploads` is created by
    // migration 0026 like every other bucket. A request path that creates
    // infrastructure is a request path that can create it WRONG — this one
    // used to be the only place a bucket's limits were set, which is
    // exactly how they ended up unset on every bucket a migration made.
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

  const diagnostics = outcome.diagnostics;
  // One structured line per upload, always — the flag below only controls
  // what reaches the BROWSER, never whether we can see this in the logs.
  console.info(
    "[ticket-upload] extraction",
    JSON.stringify({
      uploadId: row.id,
      status: outcome.status,
      extractor: deps.extractor.name,
      models: diagnostics?.attempts.map((a) => a.model),
      latencyMs: diagnostics?.attempts.map((a) => a.latencyMs),
      segments: diagnostics?.segments.length,
      chosenIndex: diagnostics?.chosenIndex,
      selectionReason: diagnostics?.selectionReason,
      dropped: diagnostics?.droppedFields.map((d) => d.field),
      ...(outcome.status === "unreadable" ? { reason: outcome.reason } : {}),
    }),
  );

  if (outcome.status === "unreadable" || !hasExtractedFields(outcome.result)) {
    await deps.setUploadStatus({ id: row.id, status: "unreadable" });
    return {
      ok: false,
      status: 200,
      error: UPLOAD_COPY.unreadable,
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  await deps.setUploadStatus({ id: row.id, status: "extracted" });

  const result = outcome.result;
  const prefill: TicketPrefill = {
    ...(result.flightNumber ? { flightNumber: result.flightNumber } : {}),
    ...(result.airlineIata ? { airlineIata: result.airlineIata } : {}),
    ...(result.departureAirport ? { departureAirport: result.departureAirport } : {}),
    ...(result.departureAtLocal ? { departureAtLocal: result.departureAtLocal } : {}),
    ...(result.destinationAirport ? { destinationAirport: result.destinationAirport } : {}),
    ...(result.paxName ? { paxName: result.paxName } : {}),
    ...(result.scope ? { scope: result.scope } : {}),
    ...(result.documentKind ? { documentKind: result.documentKind } : {}),
    ...(result.selectionReason ? { selectionReason: result.selectionReason } : {}),
    ...(result.nonServicedOrigin ? { nonServicedOrigin: result.nonServicedOrigin } : {}),
    ...(alternativesFor(result.alternativeSegments).length > 0
      ? { alternatives: alternativesFor(result.alternativeSegments) }
      : {}),
    confidence: result.confidence,
    uploadId: row.id,
  };
  return { ok: true, uploadId: row.id, prefill, ...(diagnostics ? { diagnostics } : {}) };
}

/**
 * The other NYC-departing legs, trimmed to what the swap offer needs.
 *
 * Capped at two and stripped to four fields on purpose: the whole draft rides
 * in a 4 KB cookie, and a third alternative has never been a real itinerary.
 */
function alternativesFor(segments: ExtractedSegment[] | undefined): PrefillAlternative[] {
  const serviced = AIRPORT_CODES as readonly string[];
  return (segments ?? [])
    .filter((segment) => segment.originAirport && serviced.includes(segment.originAirport))
    .slice(0, 2)
    .map((segment) => {
      // Derived from THIS segment's destination country, by the same helper
      // the chosen leg uses — so a swap carries a scope we actually read
      // rather than inheriting the other leg's or falling back to domestic.
      const scope = deriveScope(segment);
      return {
        departureAirport: segment.originAirport as (typeof AIRPORT_CODES)[number],
        ...(segment.destinationAirport
          ? { destinationAirport: segment.destinationAirport }
          : {}),
        ...(segment.flightNumber ? { flightNumber: segment.flightNumber } : {}),
        ...(segment.departureAtLocal ? { departureAtLocal: segment.departureAtLocal } : {}),
        ...(scope ? { scope } : {}),
      };
    });
}
