"use client";

import { useActionState } from "react";
import {
  Button,
  FormMessage,
  Input,
  Label,
  Spinner,
  usePreservedFormValues,
} from "@koolee/ui";

import { deactivateStaff, inviteStaff, type StaffActionState } from "./actions";

export function InviteStaffForm() {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    inviteStaff,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="new.agent@koolee.cloud"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          required
          defaultValue="agent"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
      <Button type="submit">{pending ? <Spinner /> : "Send invite"}</Button>
    </form>
  );
}

export function DeactivateStaffButton({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    deactivateStaff,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? <Spinner /> : "Deactivate"}
      </Button>
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}
