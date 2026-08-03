import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendOtp } from "./auth";

/**
 * The proactive-conflict contract (spec Part B): a permanent account holding
 * the destination must surface as the canonical PHONE_EXISTS / EMAIL_EXISTS
 * code BEFORE Supabase is asked to send anything — the client maps exactly
 * these codes into the returning-user ("Welcome back") sign-in branch, and no
 * SMS/verification fee is ever incurred. The mapping itself lives in
 * verify-flow.tsx and is compile-checked against AuthErrorCode.
 */

const ANON_UID = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signInWithOtp: vi.fn(),
  recordOtpSend: vi.fn(),
  reconcilePhoneClaims: vi.fn(),
  reconcileEmailClaims: vi.fn(),
}));

vi.mock("@koolee/core", () => ({
  recordOtpSend: h.recordOtpSend,
  reconcilePhoneClaims: h.reconcilePhoneClaims,
  reconcileEmailClaims: h.reconcileEmailClaims,
  attachEmail: vi.fn(),
  attachVerifiedPhone: vi.fn(),
  deleteAnonymousCustomer: vi.fn(),
  ensureCustomerFromAuth: vi.fn(),
  reparentBookingDraft: vi.fn(),
  sendBookingConfirmationEmail: vi.fn(),
  ConflictError: class ConflictError extends Error {
    field: "phone" | "email";
    constructor(field: "phone" | "email", message?: string) {
      super(message ?? field);
      this.field = field;
    }
  },
}));

vi.mock("@/env", () => ({ optionalEnv: () => undefined }));
vi.mock("@/lib/core", () => ({ tryGetCore: () => ({ db: {} }) }));
vi.mock("@/lib/supabase/admin", () => ({ deleteAuthUser: vi.fn() }));
vi.mock("@/lib/draft-sync", () => ({ syncDraftRow: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: {
      getUser: h.getUser,
      updateUser: h.updateUser,
      signInWithOtp: h.signInWithOtp,
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("sendOtp — proactive conflict detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({
      data: { user: { id: ANON_UID, is_anonymous: true } },
    });
    h.recordOtpSend.mockResolvedValue({ allowed: true });
  });

  it("returns canonical PHONE_EXISTS and attempts no SMS send on a phone conflict", async () => {
    h.reconcilePhoneClaims.mockResolvedValue({
      conflict: true,
      removedAnonymousUserIds: [],
    });

    const result = await sendOtp({
      phone: "3322602829",
      turnstileToken: null,
      intent: "upgrade",
    });

    // The exact code the client maps into the returning-user sign-in branch.
    expect(result).toMatchObject({ ok: false, code: "PHONE_EXISTS" });
    // The whole point of proactive detection: nothing was sent.
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns canonical EMAIL_EXISTS and attempts no email send on an email conflict", async () => {
    h.reconcileEmailClaims.mockResolvedValue({
      conflict: true,
      removedAnonymousUserIds: [],
    });

    const result = await sendOtp({
      email: "traveler@example.com",
      turnstileToken: null,
      intent: "upgrade",
    });

    expect(result).toMatchObject({ ok: false, code: "EMAIL_EXISTS" });
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("hands the throttle the plaintext destination plus its kind — hashing is internal", async () => {
    h.reconcilePhoneClaims.mockResolvedValue({
      conflict: false,
      removedAnonymousUserIds: [],
    });
    h.updateUser.mockResolvedValue({ error: null });

    await sendOtp({ phone: "3322602829", turnstileToken: null, intent: "upgrade" });

    expect(h.recordOtpSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: ANON_UID,
        destination: "+13322602829",
        kind: "phone",
      }),
    );
  });

  it("stops at rate_limited before reconciliation or any send", async () => {
    h.recordOtpSend.mockResolvedValue({ allowed: false, reason: "destination_capped" });

    const result = await sendOtp({
      phone: "3322602829",
      turnstileToken: null,
      intent: "upgrade",
    });

    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(h.reconcilePhoneClaims).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });
});
