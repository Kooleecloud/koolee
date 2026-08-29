"use client";

import { useActionState } from "react";
import {
  Button,
  FormMessage,
  Input,
  Label,
  Select,
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
        <Select id="invite-role" name="role" required defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </Select>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
      <Button type="submit" loading={pending}>
        Send invite
      </Button>
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
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Deactivate
      </Button>
      {state.error ? (
        <FormMessage className="px-2 py-1 text-xs">{state.error}</FormMessage>
      ) : null}
    </form>
  );
}
