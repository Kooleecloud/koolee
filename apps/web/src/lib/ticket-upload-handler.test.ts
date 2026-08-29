import { describe, expect, it } from "vitest";
import { FakeTicketExtractor, MAX_TICKET_UPLOAD_BYTES } from "@koolee/core";

import {
  handleTicketUpload,
  UPLOAD_COPY,
  type TicketUploadDeps,
} from "./ticket-upload-handler";

/**
 * The upload pipeline with fakes: limits, mime allowlist, private-bucket
 * storage path, `ticket_uploads` row creation, and the quarantine contract —
 * the pipeline returns a review-form prefill and touches nothing else.
 */

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

function makeDeps() {
  const calls = {
    uploads: [] as Array<{ path: string; contentType: string; bytes: number }>,
    rows: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<{ id: string; status: string }>,
  };
  const extractor = new FakeTicketExtractor();
  const deps: TicketUploadDeps = {
    draftId: DRAFT_ID,
    extractor,
    storage: {
      async upload(path, data, contentType) {
        calls.uploads.push({ path, contentType, bytes: data.byteLength });
      },
    },
    async createUploadRow(input) {
      calls.rows.push({ ...input });
      return { id: "22222222-2222-4222-8222-222222222222" };
    },
    async setUploadStatus(input) {
      calls.statuses.push(input);
    },
  };
  return { deps, calls, extractor };
}

const pdfFile = (bytes = 1024) => ({
  data: new Uint8Array(bytes).fill(1),
  mimeType: "application/pdf",
  fileName: "ticket.pdf",
});

describe("handleTicketUpload", () => {
  it("rejects a missing file", async () => {
    const { deps, calls } = makeDeps();
    const outcome = await handleTicketUpload(deps, null);
    expect(outcome).toEqual({ ok: false, status: 400, error: UPLOAD_COPY.missing });
    expect(calls.uploads).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });

  it("enforces the size limit before any storage write", async () => {
    const { deps, calls } = makeDeps();
    const outcome = await handleTicketUpload(deps, pdfFile(MAX_TICKET_UPLOAD_BYTES + 1));
    expect(outcome).toEqual({ ok: false, status: 413, error: UPLOAD_COPY.tooLarge });
    expect(calls.uploads).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });

  it("enforces the mime allowlist", async () => {
    const { deps, calls } = makeDeps();
    const outcome = await handleTicketUpload(deps, {
      data: new Uint8Array(10).fill(1),
      mimeType: "application/zip",
    });
    expect(outcome).toEqual({ ok: false, status: 415, error: UPLOAD_COPY.badType });
    expect(calls.uploads).toHaveLength(0);
  });

  it("stores in the private bucket under the draft's path and records the row", async () => {
    const { deps, calls } = makeDeps();
    const outcome = await handleTicketUpload(deps, pdfFile());

    expect(outcome.ok).toBe(true);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0]!.path).toMatch(
      new RegExp(`^tickets/${DRAFT_ID}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(calls.uploads[0]!.contentType).toBe("application/pdf");

    // The ticket_uploads row carries the bookkeeping, checksum included.
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0]).toMatchObject({
      draftId: DRAFT_ID,
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(String(calls.rows[0]!.checksum)).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.statuses).toEqual([
      { id: "22222222-2222-4222-8222-222222222222", status: "extracted" },
    ]);
  });

  it("returns a review-form prefill — and nothing that could write a booking", async () => {
    const { deps } = makeDeps();
    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Prefill mirrors the fake fixture and carries the confidence flag; the
    // caller is only ever handed data to show the user, never a persisted fact.
    expect(outcome.prefill).toMatchObject({
      flightNumber: "UA1189",
      departureAirport: "JFK",
      confidence: "high",
      uploadId: outcome.uploadId,
    });
  });

  it("maps an unreadable extraction to the manual-entry fallback and marks the row", async () => {
    const { deps, calls, extractor } = makeDeps();
    extractor.failWith = "no text layer";
    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome).toEqual({ ok: false, status: 200, error: UPLOAD_COPY.unreadable });
    expect(calls.statuses).toEqual([
      { id: "22222222-2222-4222-8222-222222222222", status: "unreadable" },
    ]);
  });

  it("degrades cleanly when storage fails — no row is written", async () => {
    const { deps, calls } = makeDeps();
    deps.storage.upload = async () => {
      throw new Error("bucket unavailable");
    };
    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome).toEqual({ ok: false, status: 502, error: UPLOAD_COPY.storageFailed });
    expect(calls.rows).toHaveLength(0);
  });

  it("carries the round trip's other NYC leg into the prefill for a one-click swap", async () => {
    const { deps, extractor } = makeDeps();
    extractor.result = {
      flightNumber: "DL200",
      airlineIata: "DL",
      departureAirport: "JFK",
      destinationAirport: "MIA",
      departureAtLocal: "2026-09-05T09:00",
      paxName: "Jordan Alvarez",
      scope: "domestic",
      documentKind: "multi_city",
      selectionReason: "ambiguous_serviced_origins",
      alternativeSegments: [
        {
          originAirport: "EWR",
          destinationAirport: "AUS",
          flightNumber: "UA300",
          departureAtLocal: "2026-09-19T09:00",
        },
        // Not a serviced departure: never offered as a swap.
        { originAirport: "AUS", destinationAirport: "EWR", flightNumber: "UA301" },
      ],
      confidence: "low",
    };

    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prefill.selectionReason).toBe("ambiguous_serviced_origins");
    expect(outcome.prefill.destinationAirport).toBe("MIA");
    expect(outcome.prefill.alternatives).toEqual([
      {
        departureAirport: "EWR",
        destinationAirport: "AUS",
        flightNumber: "UA300",
        departureAtLocal: "2026-09-19T09:00",
      },
    ]);
  });

  /**
   * Each alternative carries the domestic/international reading derived from
   * ITS OWN destination country.
   *
   * Found in the browser: swapping to a leg bound for Paris left the review
   * form showing "Domestic", because the swap cleared `scope` and the form's
   * fallback is domestic. That is the same silent-fallback failure the JFK
   * airport default was fixed for — and it picks a shorter bag-drop cutoff
   * (45 vs 60 minutes), so it is an operational error, not a cosmetic one.
   */
  it("gives every alternative leg its own scope, read from that leg's destination country", async () => {
    const { deps, extractor } = makeDeps();
    extractor.result = {
      flightNumber: "AI191",
      airlineIata: "AI",
      departureAirport: "JFK",
      destinationAirport: "LHR",
      departureAtLocal: "2026-12-18T09:40",
      paxName: "Dana Whitfield",
      scope: "international",
      documentKind: "multi_city",
      selectionReason: "ambiguous_serviced_origins",
      alternativeSegments: [
        {
          originAirport: "EWR",
          destinationAirport: "CDG",
          destinationCountry: "FR",
          flightNumber: "AI256",
          departureAtLocal: "2026-12-29T17:20",
        },
        {
          originAirport: "LGA",
          destinationAirport: "ORD",
          destinationCountry: "US",
          flightNumber: "AA10",
          departureAtLocal: "2026-12-30T08:00",
        },
      ],
      confidence: "low",
    };

    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prefill.alternatives).toEqual([
      {
        departureAirport: "EWR",
        destinationAirport: "CDG",
        flightNumber: "AI256",
        departureAtLocal: "2026-12-29T17:20",
        scope: "international",
      },
      {
        departureAirport: "LGA",
        destinationAirport: "ORD",
        flightNumber: "AA10",
        departureAtLocal: "2026-12-30T08:00",
        scope: "domestic",
      },
    ]);
  });

  it("reports an unserviceable origin instead of a bare 'we couldn't read this'", async () => {
    const { deps, extractor } = makeDeps();
    extractor.result = {
      paxName: "Alex Traveler",
      nonServicedOrigin: "SFO",
      selectionReason: "no_serviced_origin",
      confidence: "low",
    };

    const outcome = await handleTicketUpload(deps, pdfFile());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prefill.departureAirport).toBeUndefined();
    expect(outcome.prefill.nonServicedOrigin).toBe("SFO");
  });
});
