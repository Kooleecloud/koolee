"use server";

import { z } from "zod";
import { checkCoverage } from "@koolee/core";

export interface WaitlistState {
  status: "idle" | "success" | "in-coverage" | "error";
  message?: string;
}

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "ZIP code should be 5 digits.")
    .optional()
    .or(z.literal("")),
});

export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    zip: formData.get("zip") ?? "",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  const { email, zip } = parsed.data;

  // A covered ZIP doesn't need a waitlist — send them to book instead.
  if (zip && checkCoverage(zip).covered) {
    return { status: "in-coverage" };
  }

  // TODO(waitlist): persist to a waitlist table and notify via Resend. Same
  // stub as captureOutOfAreaEmail in the booking flow — replace both together.
  console.log("[waitlist] captured", { email, zip: zip || null });

  return { status: "success" };
}
