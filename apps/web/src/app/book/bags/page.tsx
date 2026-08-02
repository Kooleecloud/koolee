import { Label, PageHeader, Select } from "@koolee/ui";

import { submitBags } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "How many bags" };
export const dynamic = "force-dynamic";

export default async function BagsStepPage() {
  const draft = await readDraft();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="How many bags?"
        subtitle={
          <>
            Each bag is weighed, sealed, and photographed before it leaves you. Your
            airline&apos;s own baggage fees and weight limits still apply at the bag drop.
          </>
        }
      />

      <StepForm action={submitBags} submitLabel="Continue">
        <div className="grid gap-2">
          <Label htmlFor="bagCount">Number of checked bags</Label>
          <Select
            id="bagCount"
            name="bagCount"
            defaultValue={String(draft.bagCount ?? 1)}
            required
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "bag" : "bags"}
              </option>
            ))}
          </Select>
        </div>
      </StepForm>
    </div>
  );
}
