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

/**
 * ONE card: the picture and the details that go with it.
 *
 * They were two stacked cards — "Profile picture" above "Your details" — which
 * on a laptop meant a full-width card holding a 96px avatar and a paragraph
 * explaining itself, then another full-width card below it. The picture is not
 * a subject of its own; it is one field of an identity, so it sits beside the
 * others: side by side from `sm` up, stacked on a phone with the picture
 * first, which is the order somebody scans their own profile in.
 *
 * The explanatory paragraph under the avatar is gone with it. "Your agent sees
 * this when they arrive, so they know they have the right person. Optional —
 * we show your initials otherwise" was three lines of text describing a
 * control that is self-evident once it is a camera badge on a photo.
 *
 * FIELD ORDER IS NAME → PHONE → EMAIL. The old card put the read-only contact
 * rows above the editable name, so the first thing on the page was the two
 * things you cannot change there.
 */
export function ProfileForm({
  defaults,
  avatar,
  contact,
}: {
  defaults: ProfileDefaults;
  /** The uploader, rendered by a server component that can sign the URL. */
  avatar: React.ReactNode;
  /**
   * Server-rendered read-only contact rows. A slot rather than props because
   * one of them can be `ConfirmEmailForm`, which is a form of its own.
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
        <CardContent>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            {/* Fixed column so the fields beside it do not reflow when the
                avatar swaps between initials and a photo. */}
            <div className="shrink-0 pt-1">{avatar}</div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {/*
                The <form> starts here rather than wrapping the card: the
                `contact` slot can hold ConfirmEmailForm, and <form> inside
                <form> is invalid HTML — React reports it as a hydration error
                and the browser drops the inner one.

                Nothing the action reads lives in `contact` (saveProfile takes
                fullName + email only), so the split costs no form data. The
                Save button sits outside for layout and is wired back with
                `form={formId}`, which also keeps it the form's default button
                — Enter still submits from either field.
              */}
              <form
                ref={formRef}
                id={formId}
                action={formAction}
                onSubmit={captureValues}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-2">
                  <Label htmlFor="fullName">Name</Label>
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
                      We&apos;ll send a confirmation before it&apos;s used for
                      anything.
                    </p>
                  </div>
                ) : null}
              </form>

              {contact ? (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  {contact}
                </div>
              ) : null}
            </div>
          </div>
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
