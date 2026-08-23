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
import type { Address } from "@koolee/core";

import {
  createAddress,
  deleteAddress,
  updateAddress,
  type AddressActionState,
} from "./actions";

/** Shared field set for add + edit. Values survive failed submissions. */
function AddressFields({ defaults }: { defaults?: Partial<Address> }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="label">Label (optional)</Label>
        <Input
          id="label"
          name="label"
          placeholder="Home"
          maxLength={60}
          defaultValue={defaults?.label ?? ""}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="line1">Street address</Label>
        <Input
          id="line1"
          name="line1"
          defaultValue={defaults?.line1 ?? ""}
          autoComplete="address-line1"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="line2">Apartment, floor, buzzer</Label>
        <Input
          id="line2"
          name="line2"
          defaultValue={defaults?.line2 ?? ""}
          autoComplete="address-line2"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="grid gap-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            name="city"
            defaultValue={defaults?.city ?? ""}
            autoComplete="address-level2"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            name="state"
            maxLength={2}
            placeholder="NY"
            defaultValue={defaults?.state ?? ""}
            autoComplete="address-level1"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="zip">ZIP</Label>
          <Input
            id="zip"
            name="zip"
            inputMode="numeric"
            maxLength={10}
            placeholder="10001"
            defaultValue={defaults?.zip ?? ""}
            autoComplete="postal-code"
            required
          />
        </div>
      </div>
    </>
  );
}

export function AddAddressForm() {
  const [state, formAction, pending] = useActionState<AddressActionState, FormData>(
    createAddress,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);
  const localRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.ok) localRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an address</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={(node) => {
            formRef.current = node;
            localRef.current = node;
          }}
          action={formAction}
          onSubmit={captureValues}
          className="flex flex-col gap-4"
        >
          <AddressFields />
          {state.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state.ok ? <FormMessage variant="success">Address saved.</FormMessage> : null}
          <Button type="submit" loading={pending}>
            Save address
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function EditAddressForm({ address }: { address: Address }) {
  const [state, formAction, pending] = useActionState<AddressActionState, FormData>(
    updateAddress,
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
      <input type="hidden" name="addressId" value={address.id} />
      <AddressFields defaults={address} />
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">Saved.</FormMessage> : null}
      <Button type="submit" variant="outline" loading={pending}>
        Save changes
      </Button>
    </form>
  );
}

export function DeleteAddressButton({ addressId }: { addressId: string }) {
  const [state, formAction, pending] = useActionState<AddressActionState, FormData>(
    deleteAddress,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="addressId" value={addressId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Delete
      </Button>
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}
