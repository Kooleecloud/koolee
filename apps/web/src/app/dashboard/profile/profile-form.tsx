"use client";

import * as React from "react";
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

export function ProfileForm({
  defaults,
  contact,
}: {
  defaults: ProfileDefaults;
  /**
   * Server-rendered read-only contact rows, shown above the editable fields
   * so name, phone and email read as one card rather than two.
   */
  contact?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    saveProfile,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);
  const formId = React.useId();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contact ? (
            <div className="flex flex-col gap-4 border-b border-border pb-4">
              {contact}
            </div>
          ) : null}

          {/*
            The <form> starts here rather than wrapping the whole card: the
            `contact` slot can hold ConfirmEmailForm, which is a form of its
            own, and <form> inside <form> is invalid HTML — React reports it
            as a hydration error and the browser drops the inner one.

            Nothing the action reads lives in `contact` (saveProfile takes
            fullName + email only), so the split costs no form data. The Save
            button sits outside this element for layout and is wired back to
            it with `form={formId}`, which also keeps it the form's default
            button — Enter still submits from either field.
          */}
          <form
            ref={formRef}
            id={formId}
            action={formAction}
            onSubmit={captureValues}
            className="flex flex-col gap-4"
          >
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
          </form>
        </CardContent>
      </Card>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">Profile saved.</FormMessage>}

      <Button type="submit" form={formId} loading={pending} className="self-start">
        Save profile
      </Button>
    </div>
  );
}
