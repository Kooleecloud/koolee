"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, FormMessage, Input, Label } from "@koolee/ui";

import { saveProfile, type ProfileActionState } from "./actions";

export interface ProfileDefaults {
  fullName: string;
  email: string;
  emailLocked: boolean;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    saveProfile,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fullName">Name</Label>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={defaults.fullName}
              autoComplete="name"
              required
            />
            <p className="text-xs text-muted-foreground">
              Prefilled from the name on your ticket.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={defaults.email}
              autoComplete="email"
              disabled={defaults.emailLocked}
            />
            {defaults.emailLocked ? (
              <p className="text-xs text-muted-foreground">
                This email is on your account already.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved pickup address</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="line1">Street address</Label>
            <Input id="line1" name="line1" defaultValue={defaults.line1} autoComplete="address-line1" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="line2">Apartment, floor, buzzer</Label>
            <Input id="line2" name="line2" defaultValue={defaults.line2} autoComplete="address-line2" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" defaultValue={defaults.city} autoComplete="address-level2" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" maxLength={2} defaultValue={defaults.state} autoComplete="address-level1" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zip">ZIP</Label>
              <Input id="zip" name="zip" inputMode="numeric" defaultValue={defaults.zip} autoComplete="postal-code" />
            </div>
          </div>
        </CardContent>
      </Card>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">Profile saved.</FormMessage>}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
