"use client";

import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
  usePreservedFormValues,
} from "@koolee/ui";

import { saveProfile, type ProfileActionState } from "./actions";

export interface ProfileDefaults {
  fullName: string;
  email: string;
  /** True when the account already has an email — read-only then. */
  emailLocked: boolean;
}

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    saveProfile,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fullName">Display name</Label>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={defaults.fullName}
              autoComplete="name"
              required
            />
          </div>

          {!defaults.emailLocked ? (
            <div className="grid gap-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={defaults.email}
                autoComplete="email"
              />
              <p className="text-xs text-muted-foreground">
                We&apos;ll send a confirmation before it&apos;s used for anything.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">Profile saved.</FormMessage>}

      <Button type="submit" loading={pending} className="self-start">
        Save profile
      </Button>
    </form>
  );
}
