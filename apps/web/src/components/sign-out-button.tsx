"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@koolee/ui";

/**
 * Submit button for the sign-out server-action form. Must render inside the
 * <form> so useFormStatus can surface the pending state — previously sign-out
 * gave no feedback at all.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" loading={pending}>
      Sign out
    </Button>
  );
}
