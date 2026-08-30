export * from "./errors";
export * from "./config";
export * from "./runtime";

export * from "./booking";
export * from "./extraction";
export * from "./uploads";
export * from "./slots";
export * from "./pricing";
export * from "./payments";
export * from "./passport";
export * from "./auth";
export * from "./coverage";
export * from "./geo";
export * from "./waitlist";
export * from "./services";
export * from "./notifications";
export * from "./events";

/**
 * Row types, re-exported so apps get them without importing @koolee/db —
 * which the app ESLint config forbids, so that all data access goes through a
 * core service.
 */
export type {
  Address,
  AgreementAcceptance,
  AgreementVersion,
  Airport,
  AirlineCutoff,
  AirportCode,
  Bag,
  Booking,
  BookingDraft as BookingDraftRow,
  BookingSignal,
  BookingStatus,
  CustodyEvent,
  CutoffScope,
  DriverPosition,
  DriverShift,
  PassportVerification,
  PassportVerificationStatus,
  PassportValidityCheckStatus,
  Payment,
  PaymentStatus,
  PickupTask,
  PricingRule,
  Slot,
  SlotBlock,
  SlotTier,
  StaffMember,
  TaskStatus,
  TicketExtractionStatus,
  Truck,
  TicketUpload,
  User,
  UserRole,
  VerificationTask,
  WaitlistSignupRow,
  WaitlistSource,
} from "@koolee/db";
