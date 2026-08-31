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

/**
 * Everything these actions mutate is rendered by `/dashboard/profile` —
 * saved addresses included, since `/dashboard/addresses` is now a redirect
 * onto it. Without this the action returns `ok`, the form says "saved", and
 * the page keeps showing the old value out of the client Router Cache: the
 * server component never re-ran. Matches what every admin action already does.
 */
const PROFILE_PATH = "/dashboard/profile";

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
  /**
   * Posted as hidden fields by the autocomplete, and only ever present when
   * the customer picked a suggestion — the form clears them on any hand edit.
   * Coerced from strings because that is what a form sends; anything
   * unparseable becomes undefined and the ZIP centroid answers instead.
   */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  placeId: z.string().max(255).optional().or(z.literal("")),
});

async function requireSession() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) return null;
  return customerSessionFromAuthUser(authUser);
}

/** Undefined rather than "" — the schema's coercion turns "" into 0. */
function optional(form: FormData, key: string): string | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

function parseAddress(form: FormData) {
  return addressSchema.safeParse({
    label: String(form.get("label") ?? "").trim(),
    line1: String(form.get("line1") ?? "").trim(),
    line2: String(form.get("line2") ?? "").trim(),
    city: String(form.get("city") ?? "").trim(),
    state: String(form.get("state") ?? "").trim().toUpperCase(),
    zip: String(form.get("zip") ?? "").trim(),
    lat: optional(form, "lat"),
    lng: optional(form, "lng"),
    placeId: optional(form, "placeId"),
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
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      placeId: parsed.data.placeId || null,
    });
  } catch (error) {
    if (error instanceof OutOfCoverageError) {
      return { error: "That ZIP is outside our current service area." };
    }
    console.error("[addresses] create failed", error);
    return { error: "Something went wrong saving the address." };
  }

  revalidatePath(PROFILE_PATH);
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
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      placeId: parsed.data.placeId || null,
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

  revalidatePath(PROFILE_PATH);
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

  revalidatePath(PROFILE_PATH);
  return { ok: true };
}
