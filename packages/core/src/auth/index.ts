export type {
  AdminSession,
  AdminSessionReader,
  AgentSession,
  AgentSessionReader,
  BaseSession,
  CustomerSession,
  CustomerSessionReader,
  Session,
  SessionReader,
} from "./types";
export {
  canActOnBooking,
  isAdminSession,
  isAgentSession,
  isCustomerSession,
} from "./types";

export {
  createSupabaseCustomerSessionReader,
  verifySupabaseCustomerSession,
  type SupabaseAuthConfig,
} from "./supabase-customer";

export { requireUser, requireVerifiedUser } from "./guards";

export { assertRole } from "./require-role";

export {
  OTP_DESTINATION_WINDOW_MINUTES,
  OTP_MAX_SENDS_PER_DESTINATION,
  OTP_MAX_SENDS_PER_USER,
  OTP_USER_WINDOW_MINUTES,
  pruneOtpSendLog,
  recordOtpSend,
  type OtpSendAllowance,
  type RecordOtpSendInput,
} from "./otp-throttle";

export {
  reconcileEmailClaims,
  reconcilePhoneClaims,
  type ReconcileClaimsOptions,
  type ReconcileClaimsResult,
} from "./reconcile-claims";

export {
  guardUpgradeOtpSend,
  type UpgradeSendGuardInput,
  type UpgradeSendGuardResult,
} from "./upgrade-guard";
