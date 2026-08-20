import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendOtp, verifyOtp } from "./auth";

/**
 * The proactive-conflict contract (spec Part B): a permanent account holding
 * the destination must surface as the canonical PHONE_EXISTS / EMAIL_EXISTS
 * code BEFORE Supabase is asked to send anything — the client maps exactly
 * these codes into the returning-user ("Welcome back") sign-in branch, and no
 * SMS/verification fee is ever incurred. The mapping itself lives in
 * verify-flow.tsx and is compile-checked against AuthErrorCode.
 *
 * Both pre-send controls run through ONE core call, `guardUpgradeOtpSend`
 * (throttle + reconciliation in a single transaction) — these tests pin the
 * action's mapping of its result to the client-facing codes.
 */

const ANON_UID = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signInWithOtp: vi.fn(),
  guardUpgradeOtpSend: vi.fn(),
  isComingSoon: vi.fn(() => false),
}));

vi.mock("@koolee/core", () => ({
  guardUpgradeOtpSend: h.guardUpgradeOtpSend,
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

vi.mock("@/env", () => ({
  optionalEnv: () => undefined,
  authSchemaAvailable: true,
  isComingSoon: h.isComingSoon,
}));
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
    h.guardUpgradeOtpSend.mockResolvedValue({
      allowed: true,
      conflict: false,
      removedAnonymousUserIds: [],
    });
  });

  it("returns canonical PHONE_EXISTS and attempts no SMS send on a phone conflict", async () => {
    h.guardUpgradeOtpSend.mockResolvedValue({
      allowed: true,
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
    h.guardUpgradeOtpSend.mockResolvedValue({
      allowed: true,
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

  it("hands the guard the plaintext destination, its kind, and the env's reconcile decision", async () => {
    h.updateUser.mockResolvedValue({ error: null });

    await sendOtp({ phone: "3322602829", turnstileToken: null, intent: "upgrade" });

    expect(h.guardUpgradeOtpSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: ANON_UID,
        destination: "+13322602829",
        kind: "phone",
        // Mirrors `authSchemaAvailable` from @/env — the explicit declaration
        // that replaced 42P01 error-code sniffing.
        reconcile: true,
        deleteAuthUser: expect.any(Function),
      }),
    );
  });

  it("stops at rate_limited before any send", async () => {
    h.guardUpgradeOtpSend.mockResolvedValue({
      allowed: false,
      reason: "destination_capped",
      conflict: false,
      removedAnonymousUserIds: [],
    });

    const result = await sendOtp({
      phone: "3322602829",
      turnstileToken: null,
      intent: "upgrade",
    });

    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("fails closed to provider_error when the guard itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.guardUpgradeOtpSend.mockRejectedValue(new Error("relation auth.users does not exist"));

    const result = await sendOtp({
      phone: "3322602829",
      turnstileToken: null,
      intent: "upgrade",
    });

    // Sending with an unresolved claim is the wrong-user bug the guard
    // exists for — a broken guard must block the send, not wave it through.
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("coming-soon mode — pre-launch hard stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isComingSoon.mockReturnValue(true);
    h.getUser.mockResolvedValue({
      data: { user: { id: ANON_UID, is_anonymous: true } },
    });
  });

  afterEach(() => {
    // mockReturnValue survives clearAllMocks — restore the live default so
    // this block stays order-independent.
    h.isComingSoon.mockReturnValue(false);
  });

  it("sendOtp refuses before touching Supabase or the throttle", async () => {
    const result = await sendOtp({
      phone: "3322602829",
      turnstileToken: null,
      intent: "upgrade",
    });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    // The gate must hold at the action layer: no guard run, nothing sent.
    expect(h.guardUpgradeOtpSend).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("verifyOtp refuses, so no session can be established", async () => {
    const result = await verifyOtp({
      mode: "sms",
      target: "+13322602829",
      code: "123456",
    });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(h.getUser).not.toHaveBeenCalled();
  });
});
