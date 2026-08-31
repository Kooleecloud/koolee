"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  Button,
  cn,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
  NumberStepper,
} from "@koolee/ui";

import { submitPickup, type ActionState } from "@/app/book/actions";
import {
  AddressAutocomplete,
  type SelectedPlace,
} from "@/components/address-autocomplete";
import { OutOfAreaCapture } from "@/components/out-of-area-capture";

/** The subset of a saved address the quick-fill buttons need. */
export interface SavedAddressOption {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  /**
   * Carried so a saved address does not LOSE precision when it is re-used. A
   * row that gained real coordinates from autocomplete once should not be
   * re-submitted as a bare street line and fall back to a ZIP centroid.
   */
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

interface AddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * The precise point behind the fields above, when there is one.
 *
 * Held separately and posted as hidden inputs, because it is not something
 * the customer types. It is CLEARED by any hand edit to an address field —
 * coordinates belonging to a different address are worse than none: the price
 * and the driver's map link would both point at the wrong door while looking
 * exactly as confident as a correct one.
 */
interface AddressPrecision {
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

const NO_PRECISION: AddressPrecision = { lat: null, lng: null, placeId: null };

/**
 * Step 2 — pickup address + bag count, one submit.
 *
 * The address inputs are controlled so a saved address can fill them with one
 * tap without a server round-trip (and so values survive a failed submit).
 * An out-of-area ZIP swaps the form for the waitlist capture, same as the
 * flight step.
 */
export function PickupStepForm({
  savedAddresses,
  defaults,
}: {
  savedAddresses: SavedAddressOption[];
  defaults: AddressFields & AddressPrecision & { bagCount: number };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    submitPickup,
    {},
  );
  const [address, setAddress] = useState<AddressFields>({
    line1: defaults.line1,
    line2: defaults.line2,
    city: defaults.city,
    state: defaults.state,
    zip: defaults.zip,
  });
  const [precision, setPrecision] = useState<AddressPrecision>({
    lat: defaults.lat,
    lng: defaults.lng,
    placeId: defaults.placeId,
  });
  // Which saved address is currently filling the form. Purely a display
  // concern — the submitted values are the inputs, not this id.
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} retryHref="/book/pickup" />;
  }

  /**
   * A hand edit to any address field drops the coordinates. `line2` is
   * included: a buzzer change does not move the building, but it is not worth
   * a rule nobody can remember, and the ZIP centroid is a fine answer.
   */
  const set =
    (key: keyof AddressFields) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setAddress((current) => ({ ...current, [key]: event.target.value }));
      setPrecision(NO_PRECISION);
    };

  const onPlaceSelected = (place: SelectedPlace) => {
    setSelectedAddressId(null);
    setAddress((current) => ({
      ...current,
      line1: place.line1,
      city: place.city,
      state: place.state,
      zip: place.zip,
      // `line2` is deliberately untouched: Places may know a unit number, but
      // the customer is the authority on their own buzzer, and clobbering
      // what they typed would be worse than leaving it.
    }));
    setPrecision({ lat: place.lat, lng: place.lng, placeId: place.placeId });
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {savedAddresses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your saved addresses</CardTitle>
            <CardDescription>One tap fills the form below.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {savedAddresses.map((saved) => {
              const street = saved.line2 ? `${saved.line1}, ${saved.line2}` : saved.line1;
              // A label is optional, and when it is missing the street doubles
              // as the heading — so the full line must not repeat it back
              // underneath. Unlabelled addresses showed "22 W 34th St" twice.
              const heading = saved.label || street;
              const detail =
                saved.label ? `${street}, ${saved.city} ${saved.state} ${saved.zip}`
                : `${saved.city} ${saved.state} ${saved.zip}`;
              return (
                <button
                  key={saved.id}
                  type="button"
                  aria-pressed={selectedAddressId === saved.id}
                  onClick={() => {
                    setSelectedAddressId(saved.id);
                    setAddress({
                      line1: saved.line1,
                      line2: saved.line2 ?? "",
                      city: saved.city,
                      state: saved.state,
                      zip: saved.zip,
                    });
                    setPrecision({
                      lat: saved.lat,
                      lng: saved.lng,
                      placeId: saved.placeId,
                    });
                  }}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    "hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                    selectedAddressId === saved.id
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{heading}</span>
                    {/* Confirms which one filled the form — tapping a second
                        address silently overwrote the first with no feedback. */}
                    {selectedAddressId === saved.id && (
                      <Check aria-hidden className="size-4 shrink-0 text-primary" />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        <Label htmlFor="line1">Street address</Label>
        <AddressAutocomplete
          id="line1"
          name="line1"
          value={address.line1}
          onValueChange={(next) => {
            setAddress((current) => ({ ...current, line1: next }));
            setPrecision(NO_PRECISION);
          }}
          onPlaceSelected={onPlaceSelected}
          required
        />
        {/* The point behind the address, when a suggestion supplied one.
            Hidden inputs rather than state posted separately, so they travel
            with the same submit as the fields they describe. */}
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
        <Label htmlFor="line2">Apartment, floor, buzzer</Label>
        <Input
          id="line2"
          name="line2"
          value={address.line2}
          onChange={set("line2")}
          autoComplete="address-line2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="grid gap-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            name="city"
            value={address.city}
            onChange={set("city")}
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
            value={address.state}
            onChange={set("state")}
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
            placeholder="10001"
            value={address.zip}
            onChange={set("zip")}
            autoComplete="postal-code"
            required
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label id="bagCount-label">Number of checked bags</Label>
        {/* Cap stays at 10, matching the select this replaced. */}
        <NumberStepper
          id="bagCount"
          name="bagCount"
          labelledBy="bagCount-label"
          defaultValue={defaults.bagCount}
          min={1}
          max={10}
          unit="bags"
        />
        <p className="text-xs text-muted-foreground">
          Each bag is weighed, sealed, and photographed before it leaves you. Your
          airline&apos;s own baggage fees and weight limits still apply at the bag drop.
        </p>
      </div>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}

      {/* The address is in a covered ZIP, just not the one we quoted. Both
          ways out are one click: re-quote here, or go back for an address in
          the ZIP the quote was for. Nothing is saved until one is chosen. */}
      {state.zipMismatch && (
        <div className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm">
          <p className="text-slate-700">
            This address is in {state.zipMismatch.addressZip}, but your quote was for{" "}
            {state.zipMismatch.quotedZip}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              name="confirmZipChange"
              value="1"
              size="sm"
              loading={pending}
            >
              Update quote to {state.zipMismatch.addressZip}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/book/pickup">Use a different address</Link>
            </Button>
          </div>
          <p className="text-xs text-slate-600">
            Updating the quote re-checks coverage and pricing for{" "}
            {state.zipMismatch.addressZip}, and you will pick your pickup window
            again.
          </p>
        </div>
      )}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Checking coverage…" : "Continue"}
      </Button>
    </form>
  );
}
