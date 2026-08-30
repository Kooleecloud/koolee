export {
  CONFIDENCE_LEVELS,
  DOCUMENT_KINDS,
  extractedSegmentSchema,
  hasExtractedFields,
  MAX_TICKET_UPLOAD_BYTES,
  SEGMENT_SELECTION_REASONS,
  TICKET_SCOPES,
  TICKET_UPLOAD_MIME_TYPES,
  ticketExtractionSchema,
  type ExtractedSegment,
  type ExtractionConfidence,
  type SegmentSelectionReason,
  type TicketDocumentKind,
  type TicketExtractionAttempt,
  type TicketExtractionDiagnostics,
  type TicketExtractionOutcome,
  type TicketExtractionResult,
  type TicketExtractionScope,
  type TicketExtractor,
  type TicketFileInput,
  type TicketUploadMimeType,
} from "./types";

export {
  deriveScope,
  normalizeSegment,
  selectSegment,
  todayAtServicedAirports,
  type DroppedField,
  type SegmentSelection,
} from "./select-segment";

export {
  assembleOutcome,
  cleanPaxName,
  type ReadItinerary,
} from "./read-result";

export { FAKE_EXTRACTION_RESULT, FakeTicketExtractor } from "./fake";
export { HeuristicTicketExtractor } from "./heuristic";
export {
  CLAUDE_ESCALATION_MODEL,
  CLAUDE_EXTRACTION_MODEL,
  ClaudeTicketExtractor,
} from "./claude";
export { createTicketExtractor, type TicketExtractorConfig } from "./factory";
