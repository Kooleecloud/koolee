import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ClaudeTicketExtractor } from "./claude";

/**
 * A LIVE probe against the real API — skipped unless you ask for it:
 *
 *   TICKET_PDF=~/Downloads/eticket.pdf \
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   pnpm --filter @koolee/core exec vitest run claude.live
 *
 * It prints the whole diagnostics blob: every segment the model read, which
 * leg was chosen and why, what was dropped, both attempts with their token
 * usage. Prompt and schema changes are otherwise unmeasurable — the mocked
 * suite proves the plumbing, this proves the reading.
 *
 * Costs a fraction of a cent per run and never runs in CI (no key, no path).
 */

const pdfPath = process.env.TICKET_PDF;
const apiKey = process.env.ANTHROPIC_API_KEY;
const mimeType = process.env.TICKET_MIME ?? "application/pdf";

describe.skipIf(!pdfPath || !apiKey)("ClaudeTicketExtractor (live)", () => {
  it("reads the document and reports how it chose", { timeout: 120_000 }, async () => {
    const data = new Uint8Array(await readFile(pdfPath!));
    const extractor = new ClaudeTicketExtractor({ apiKey: apiKey! });

    const outcome = await extractor.extract({ data, mimeType });

    console.log(JSON.stringify(outcome, null, 2));
    expect(outcome.diagnostics).toBeDefined();
  });
});
