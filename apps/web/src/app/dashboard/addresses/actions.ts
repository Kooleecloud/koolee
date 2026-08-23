"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ConflictError,
  createAddressForSession,
  deleteAddressForSession,
  NotFoundError,
  OutOfCoverageError,
  updateAddressForSession,
} from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

/**
 * Saved-address CRUD. Thin adapters over the session-scoped core services —
 * ownership and coverage are enforced there, this file only parses forms and
 * translates typed errors into copy.
 */

export interface AddressActionState {
  error?: string;
  ok?: boolean;
}

const addressSchema = z.object({
  label: z.string().max(60).optional().or(z.literal("")),
  line1: z.string().min(1, "Enter the street address.").max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(1, "Enter the city.").max(100),
  state: z.string().length(2, "Two-letter state."),
  zip: z.string().min(5).max(10),
});

async function requireSession() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) return null;
  return customerSessionFromAuthUser(authUser);
}

function parseAddress(form: FormData) {
  return addressSchema.safeParse({
    label: String(form.get("label") ?? "").trim(),
    line1: String(form.get("line1") ?? "").trim(),
    line2: String(form.get("line2") ?? "").trim(),
    city: String(form.get("city") ?? "").trim(),
    state: String(form.get("state") ?? "").trim().toUpperCase(),
    zip: String(form.get("zip") ?? "").trim(),
  });
}

export async function createAddress(
  _prev: AddressActionState,
  form: FormData,
): Promise<AddressActionState> {
  const session = await requireSession();
  if (!session) return { error: "Your session has expired — sign in again." };

  const parsed = parseAddress(form);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  try {
    await createAddressForSession(core.db, session, {
      label: parsed.data.label || null,
      line1: parsed.data.line1,
      line2: parsed.data.line2 || null,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
    });
  } catch (error) {
    if (error instanceof OutOfCoverageError) {
      return { error: "That ZIP is outside our current service area." };
    }
    console.error("[addresses] create failed", error);
    return { error: "Something went wrong saving the address." };
  }

  revalidatePath("/dashboard/profile");
  return { ok: true };
}

export async function updateAddress(
  _prev: AddressActionState,
  form: FormData,
): Promise<AddressActionState> {
  const session = await requireSession();
  if (!session) return { error: "Your session has expired — sign in again." };

  const addressId = String(form.get("addressId") ?? "");
  if (!z.uuid().safeParse(addressId).success) return { error: "Missing address." };

  const parsed = parseAddress(form);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  try {
    await updateAddressForSession(core.db, session, addressId, {
      label: parsed.data.label || null,
      line1: parsed.data.line1,
      line2: parsed.data.line2 || null,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
    });
  } catch (error) {
    if (error instanceof OutOfCoverageError) {
      return { error: "That ZIP is outside our current service area." };
    }
    if (error instanceof NotFoundError) {
      return { error: "That address no longer exists." };
    }
    console.error("[addresses] update failed", error);
    return { error: "Something went wrong saving the address." };
  }

  revalidatePath("/dashboard/profile");
  return { ok: true };
}

export async function deleteAddress(
  _prev: AddressActionState,
  form: FormData,
): Promise<AddressActionState> {
  const session = await requireSession();
  if (!session) return { error: "Your session has expired — sign in again." };

  const addressId = String(form.get("addressId") ?? "");
  if (!z.uuid().safeParse(addressId).success) return { error: "Missing address." };

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  try {
    await deleteAddressForSession(core.db, session, addressId);
  } catch (error) {
    if (error instanceof ConflictError) {
      return { error: error.message };
    }
    if (error instanceof NotFoundError) {
      return { error: "That address no longer exists." };
    }
    console.error("[addresses] delete failed", error);
    return { error: "Something went wrong deleting the address." };
  }

  revalidatePath("/dashboard/profile");
  return { ok: true };
}
