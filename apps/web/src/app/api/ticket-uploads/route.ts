import { NextResponse } from "next/server";
import { createTicketUpload, setTicketUploadStatus } from "@koolee/core";

import { ensureDraftId, writeDraft } from "@/lib/booking-draft";
import { ticketExtractionDebugEnabled, tryGetCore } from "@/lib/core";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  handleTicketUpload,
  TICKET_BUCKET,
  UPLOAD_COPY,
  type TicketUploadStorage,
} from "@/lib/ticket-upload-handler";

export const dynamic = "force-dynamic";
/** Buffer + hash + PDF parsing want Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * Server-side ticket upload (never client-direct to Storage): multipart in,
 * private bucket + `ticket_uploads` row + synchronous extraction, and the
 * extracted values land ONLY in the quarantined `ticketPrefill` cookie key —
 * the flight review form's editable defaults. See
 * `@/lib/ticket-upload-handler` for the pipeline and its tests.
 *
 * The bucket itself is NOT created here any more. It used to be, lazily, on
 * the first upload an environment ever received — which made a request path
 * responsible for infrastructure and left the bucket's limits as the only ones
 * in the product that were set at all. Migration 0026 owns every bucket now,
 * so a fresh environment that has not migrated fails this upload loudly
 * instead of quietly building itself something slightly different.
 *
 * With TICKET_EXTRACTION_DEBUG set, the response also carries the raw
 * extraction diagnostics so the upload page can show exactly what the model
 * returned. That payload never touches the draft cookie and is never included
 * unless the flag is explicitly on.
 */
export async function POST(request: Request) {
  const core = tryGetCore();
  const admin = getSupabaseAdminClient();
  if (!core || !admin) {
    return NextResponse.json(
      { error: "Uploads aren't available in this environment yet." },
      { status: 503 },
    );
  }

  let file: { data: Uint8Array; mimeType: string; fileName?: string } | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("ticket");
    if (entry instanceof File && entry.size > 0) {
      file = {
        data: new Uint8Array(await entry.arrayBuffer()),
        mimeType: entry.type || "application/octet-stream",
        fileName: entry.name,
      };
    }
  } catch {
    return NextResponse.json({ error: UPLOAD_COPY.missing }, { status: 400 });
  }

  const storage: TicketUploadStorage = {
    async upload(path, data, contentType) {
      const { error } = await admin.storage
        .from(TICKET_BUCKET)
        .upload(path, data, { contentType, upsert: false });
      if (error) throw new Error(`storage.upload: ${error.message}`);
    },
  };

  const draftId = await ensureDraftId();

  const outcome = await handleTicketUpload(
    {
      draftId,
      extractor: core.ticketExtractor,
      storage,
      createUploadRow: (input) => createTicketUpload(core.db, input),
      setUploadStatus: (input) => setTicketUploadStatus(core.db, input),
    },
    file,
  );

  const debug = ticketExtractionDebugEnabled() ? outcome.diagnostics : undefined;

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(debug ? { debug } : {}) },
      { status: outcome.status },
    );
  }

  // Quarantined prefill: read only by the flight review form as defaults.
  await writeDraft({ ticketPrefill: outcome.prefill });

  return NextResponse.json({
    ok: true,
    uploadId: outcome.uploadId,
    confidence: outcome.prefill.confidence,
    ...(debug ? { debug } : {}),
  });
}
