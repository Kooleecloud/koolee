import { Input, Label, PageHeader } from "@koolee/ui";

import { submitAddress } from "@/app/book/actions";
import { AddressStepForm } from "@/components/address-step-form";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "Pickup address" };
export const dynamic = "force-dynamic";

export default async function AddressStepPage() {
  const draft = await readDraft();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pickup address" subtitle="Where should we collect your bags?" />

      <AddressStepForm action={submitAddress}>
        <div className="grid gap-2">
          <Label htmlFor="line1">Street address</Label>
          <Input
            id="line1"
            name="line1"
            defaultValue={draft.line1 ?? ""}
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
            defaultValue={draft.line2 ?? ""}
            autoComplete="address-line2"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              defaultValue={draft.city ?? ""}
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
              defaultValue={draft.state ?? ""}
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
              defaultValue={draft.zip ?? ""}
              autoComplete="postal-code"
              required
            />
          </div>
        </div>
      </AddressStepForm>
    </div>
  );
}
