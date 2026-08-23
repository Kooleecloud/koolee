export {
  CONFIDENCE_LEVELS,
  hasExtractedFields,
  MAX_TICKET_UPLOAD_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
  ticketExtractionSchema,
  type ExtractionConfidence,
  type TicketExtractionOutcome,
  type TicketExtractionResult,
  type TicketExtractor,
  type TicketFileInput,
  type TicketUploadMimeType,
} from "./types";

export { FAKE_EXTRACTION_RESULT, FakeTicketExtractor } from "./fake";
export { HeuristicTicketExtractor } from "./heuristic";
export { CLAUDE_EXTRACTION_MODEL, ClaudeTicketExtractor } from "./claude";
export { createTicketExtractor, type TicketExtractorConfig } from "./factory";
