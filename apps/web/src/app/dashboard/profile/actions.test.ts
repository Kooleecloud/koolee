import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These actions have to invalidate the page they mutate.
 *
 * Saving a name returned `{ ok: true }`, the form said "Profile saved", and
 * the card kept rendering the OLD name — the server component never re-ran,
 * because a Server Action does not invalidate anything on its own and the
 * client Router Cache happily served the previous RSC payload. Nothing in
 * typecheck, lint or the type system can see that; only this can.
 *
 * The negative cases matter as much as the positive one: revalidating on a
 * failed save would throw away a correct cache entry, and revalidating on a
 * resend would re-render a page whose content did not change.
 */

const AUTH_USER = {
  id: "00000000-0000-4000-8000-0000000000aa",
  phone: "+13322602829",
  email: null as string | null,
  isAnonymous: false,
};

const h = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getAuthUser: vi.fn(),
  tryGetCore: vi.fn(),
  completeProfile: vi.fn(),
  getCustomerById: vi.fn(),
  guardUpgradeOtpSend: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

vi.mock("@koolee/core", () => ({
  completeProfile: h.completeProfile,
  getCustomerById: h.getCustomerById,
  guardUpgradeOtpSend: h.guardUpgradeOtpSend,
  attachEmail: vi.fn(),
  markEmailVerified: vi.fn(),
  ConflictError: class ConflictError extends Error {},
}));

vi.mock("@/env", () => ({ authSchemaAvailable: false }));
vi.mock("@/lib/auth", () => ({ getAuthUser: h.getAuthUser }));
vi.mock("@/lib/core", () => ({ tryGetCore: h.tryGetCore }));
vi.mock("@/lib/supabase/admin", () => ({ deleteAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { updateUser: h.updateUser } }),
}));

import { resendEmailCode, saveProfile } from "./actions";

const PROFILE_PATH = "/dashboard/profile";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getAuthUser.mockResolvedValue({ ...AUTH_USER });
  h.tryGetCore.mockReturnValue({ db: {} });
  h.completeProfile.mockResolvedValue({});
});

describe("saveProfile", () => {
  it("revalidates the profile page after a successful save", async () => {
    const result = await saveProfile({}, form({ fullName: "Ana Maria Ruiz", email: "" }));

    expect(result).toEqual({ ok: true });
    expect(h.completeProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fullName: "Ana Maria Ruiz" }),
    );
    expect(h.revalidatePath).toHaveBeenCalledWith(PROFILE_PATH);
  });

  it("does not revalidate when validation fails", async () => {
    const result = await saveProfile({}, form({ fullName: "", email: "" }));

    expect(result.error).toBeTruthy();
    expect(h.completeProfile).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate when the write throws", async () => {
    h.completeProfile.mockRejectedValue(new Error("column does not exist"));

    const result = await saveProfile({}, form({ fullName: "Ana", email: "" }));

    expect(result.error).toBeTruthy();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate for a signed-out or anonymous session", async () => {
    h.getAuthUser.mockResolvedValue({ ...AUTH_USER, isAnonymous: true });

    const result = await saveProfile({}, form({ fullName: "Ana", email: "" }));

    expect(result.error).toBeTruthy();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("resendEmailCode", () => {
  it("does NOT revalidate — a resend changes nothing the page renders", async () => {
    h.getCustomerById.mockResolvedValue({
      email: "traveller@example.com",
      emailVerifiedAt: null,
    });
    h.guardUpgradeOtpSend.mockResolvedValue({ allowed: true, conflict: false });
    h.updateUser.mockResolvedValue({ error: null });

    const result = await resendEmailCode();

    expect(result).toEqual({ ok: true });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
