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
export * from "./observability";
export * from "./events";

/**
 * The pgEnum objects themselves (not just their types), so a package that
 * cannot import @koolee/db can still read `.enumValues` at runtime —
 * apps/agent's contract-parity test compares the wire enums against these.
 */
export {
  bookingStatusEnum,
  passportValidityCheckStatusEnum,
  passportVerificationStatusEnum,
  paymentStatusEnum,
  taskStatusEnum,
  userRoleEnum,
} from "@koolee/db";

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
  DiscountRuleJson,
  DriverPosition,
  DriverShift,
  LeadTimeMultiplierJson,
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
