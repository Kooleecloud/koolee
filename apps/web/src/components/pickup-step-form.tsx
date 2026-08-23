"use client";

import { useActionState, useState } from "react";
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
  Select,
} from "@koolee/ui";

import { submitPickup, type ActionState } from "@/app/book/actions";
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
}

interface AddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

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
  defaults: AddressFields & { bagCount: number };
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
  const [bagCount, setBagCount] = useState(String(defaults.bagCount));
  // Which saved address is currently filling the form. Purely a display
  // concern — the submitted values are the inputs, not this id.
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} retryHref="/book/pickup" />;
  }

  const set =
    (key: keyof AddressFields) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setAddress((current) => ({ ...current, [key]: event.target.value }));

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
        <Input
          id="line1"
          name="line1"
          value={address.line1}
          onChange={set("line1")}
          autoComplete="address-line1"
          required
        />
        {/* TODO(maps): Google Places autocomplete, which also gives us the
            lat/lng and place_id the drive-time estimate needs. */}
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
        <Label htmlFor="bagCount">Number of checked bags</Label>
        <Select
          id="bagCount"
          name="bagCount"
          value={bagCount}
          onChange={(event) => setBagCount(event.target.value)}
          required
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "bag" : "bags"}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Each bag is weighed, sealed, and photographed before it leaves you. Your
          airline&apos;s own baggage fees and weight limits still apply at the bag drop.
        </p>
      </div>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Checking coverage…" : "Continue"}
      </Button>
    </form>
  );
}
