"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  toast,
} from "@koolee/ui";
import type { Address } from "@koolee/core";

import {
  AddressAutocomplete,
  type SelectedPlace,
} from "@/components/address-autocomplete";

import {
  createAddress,
  deleteAddress,
  updateAddress,
  type AddressActionState,
} from "./actions";

/**
 * Saved-address forms for the account page.
 *
 * TWO CHANGES FROM WHAT THIS WAS, both about the same complaint.
 *
 * 1. **The street field autocompletes**, the way the funnel's does. It was a
 *    plain text input here, so the one place a customer manages addresses at
 *    leisure was the one place they had to type the whole thing — and the
 *    coordinates every suggestion carries (which price the trip and aim the
 *    driver's map link) were never captured. See also `/api/places`, which had
 *    to learn that a signed-in customer is as good a claim as a booking draft.
 *
 * 2. **Outcomes are toasts, not inline messages.** A `FormMessage` appearing
 *    under the Delete button reflowed the card it was inside: the address text
 *    wrapped around the new sentence and every row below it moved. A toast
 *    says the same thing next to nothing, and the card does not move.
 *
 * The fields are CONTROLLED here, unlike the uncontrolled forms elsewhere in
 * the app, because autocomplete has to be able to fill four of them from one
 * chosen suggestion. That also means values survive a failed submit by
 * construction, which is what `usePreservedFormValues` used to provide.
 */

interface AddressFieldValues {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * The precise point behind the fields, when a suggestion supplied one.
 *
 * Held apart from the typed fields and posted as hidden inputs, because it is
 * not something the customer types — and CLEARED by any hand edit to an
 * address field. Coordinates belonging to a different address are worse than
 * none: they would misprice the trip and point the driver's map link at the
 * wrong door, while looking exactly as confident as a correct pair. Same rule
 * as the funnel's pickup step.
 */
interface AddressPrecision {
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

const NO_PRECISION: AddressPrecision = { lat: null, lng: null, placeId: null };

function emptyValues(): AddressFieldValues {
  return { label: "", line1: "", line2: "", city: "", state: "", zip: "" };
}

function valuesOf(address: Address): AddressFieldValues {
  return {
    label: address.label ?? "",
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    state: address.state,
    zip: address.zip,
  };
}

/** Shared field set for add + edit. */
function AddressFields({
  idPrefix,
  values,
  onChange,
  precision,
  onPlaceSelected,
}: {
  /** Ids must be unique per form — several of these render on one page. */
  idPrefix: string;
  values: AddressFieldValues;
  onChange: (key: keyof AddressFieldValues, value: string) => void;
  precision: AddressPrecision;
  onPlaceSelected: (place: SelectedPlace) => void;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={id("label")}>Label (optional)</Label>
        <Input
          id={id("label")}
          name="label"
          placeholder="Home"
          maxLength={60}
          value={values.label}
          onChange={(event) => onChange("label", event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("line1")}>Street address</Label>
        <AddressAutocomplete
          id={id("line1")}
          name="line1"
          value={values.line1}
          onValueChange={(next) => onChange("line1", next)}
          onPlaceSelected={onPlaceSelected}
          autoComplete="address-line1"
          required
        />
        {/* Travels with the same submit as the fields it describes. */}
        {precision.lat !== null && precision.lng !== null ? (
          <>
            <input type="hidden" name="lat" value={precision.lat} />
            <input type="hidden" name="lng" value={precision.lng} />
          </>
        ) : null}
        {precision.placeId ? (
          <input type="hidden" name="placeId" value={precision.placeId} />
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("line2")}>Apartment, floor, buzzer</Label>
        <Input
          id={id("line2")}
          name="line2"
          value={values.line2}
          onChange={(event) => onChange("line2", event.target.value)}
          autoComplete="address-line2"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="grid gap-2">
          <Label htmlFor={id("city")}>City</Label>
          <Input
            id={id("city")}
            name="city"
            value={values.city}
            onChange={(event) => onChange("city", event.target.value)}
            autoComplete="address-level2"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("state")}>State</Label>
          <Input
            id={id("state")}
            name="state"
            maxLength={2}
            placeholder="NY"
            value={values.state}
            onChange={(event) => onChange("state", event.target.value)}
            autoComplete="address-level1"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("zip")}>ZIP</Label>
          <Input
            id={id("zip")}
            name="zip"
            inputMode="numeric"
            maxLength={10}
            placeholder="10001"
            value={values.zip}
            onChange={(event) => onChange("zip", event.target.value)}
            autoComplete="postal-code"
            required
          />
        </div>
      </div>
    </>
  );
}

/**
 * The fields, their precision, and the two ways either changes. Shared by add
 * and edit so a hand edit clears the coordinates in exactly one place.
 */
function useAddressFields(
  initial: AddressFieldValues,
  initialPrecision: AddressPrecision,
) {
  const [values, setValues] = React.useState(initial);
  const [precision, setPrecision] = React.useState(initialPrecision);

  const onChange = React.useCallback((key: keyof AddressFieldValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    // The label is not part of the address, so editing it keeps the point.
    if (key !== "label") setPrecision(NO_PRECISION);
  }, []);

  const onPlaceSelected = React.useCallback((place: SelectedPlace) => {
    setValues((current) => ({
      ...current,
      line1: place.line1,
      city: place.city,
      state: place.state,
      zip: place.zip,
      // `line2` deliberately untouched: Places may know a unit number, but the
      // customer is the authority on their own buzzer.
    }));
    setPrecision({ lat: place.lat, lng: place.lng, placeId: place.placeId });
  }, []);

  const reset = React.useCallback((next: AddressFieldValues) => {
    setValues(next);
    setPrecision(NO_PRECISION);
  }, []);

  return { values, precision, onChange, onPlaceSelected, reset };
}

/**
 * Announces an action's outcome once per result.
 *
 * Keyed on the state OBJECT, not on `ok`/`error`: two failed deletes in a row
 * produce two different objects with the same message, and a toast that fires
 * only when the message changes would stay silent on the second attempt.
 */
function useActionToast(state: AddressActionState, successMessage: string) {
  const announced = React.useRef<AddressActionState | null>(null);

  React.useEffect(() => {
    if (announced.current === state) return;
    announced.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(successMessage);
  }, [state, successMessage]);
}

export function AddAddressForm() {
  const [state, formAction, pending] = useActionState<AddressActionState, FormData>(
    createAddress,
    {},
  );
  const fields = useAddressFields(emptyValues(), NO_PRECISION);
  useActionToast(state, "Address saved.");

  const { reset } = fields;
  React.useEffect(() => {
    if (state.ok) reset(emptyValues());
  }, [state, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an address</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AddressFields
            idPrefix="add-address"
            values={fields.values}
            onChange={fields.onChange}
            precision={fields.precision}
            onPlaceSelected={fields.onPlaceSelected}
          />
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
  const fields = useAddressFields(valuesOf(address), {
    lat: address.lat,
    lng: address.lng,
    placeId: address.placeId,
  });
  useActionToast(state, "Address saved.");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="addressId" value={address.id} />
      <AddressFields
        idPrefix={`edit-${address.id}`}
        values={fields.values}
        onChange={fields.onChange}
        precision={fields.precision}
        onPlaceSelected={fields.onPlaceSelected}
      />
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
  useActionToast(state, "Address removed.");

  return (
    <form action={formAction}>
      <input type="hidden" name="addressId" value={addressId} />
      {/*
        No message renders here — see the header. The refusal this most often
        produces ("Booking KOO-XXXXX has a pickup scheduled at this address")
        is a whole sentence, and inline it re-wrapped the address above it.
      */}
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        Delete
      </Button>
    </form>
  );
}
