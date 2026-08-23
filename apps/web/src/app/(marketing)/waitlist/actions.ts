"use server";

import { z } from "zod";
import { checkCoverage, recordWaitlistSignup } from "@koolee/core";

import { tryGetCore } from "@/lib/core";

export interface WaitlistState {
  status: "idle" | "success" | "in-coverage" | "error";
  message?: string;
}

const schema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  // Required: the row is a demand signal for a zone — an email without a ZIP
  // can't be notified when "your neighborhood opens".
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "ZIP code should be 5 digits."),
});

export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    zip: formData.get("zip"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  const { email, zip } = parsed.data;

  // A covered ZIP doesn't need a waitlist — send them to book instead.
  if (checkCoverage(zip).covered) {
    return { status: "in-coverage" };
  }

  const core = tryGetCore();
  if (!core) {
    // No database configured (fresh clone): honest failure beats fake success.
    return {
      status: "error",
      message: "We can't save signups right now — please try again in a few minutes.",
    };
  }

  try {
    await recordWaitlistSignup(core.db, { email, zip, source: "waitlist_page" });
  } catch (error) {
    console.error("[waitlist] failed to persist signup", error);
    return {
      status: "error",
      message: "Something went wrong saving your spot — please try again.",
    };
  }

  return { status: "success" };
}
