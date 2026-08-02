import { Label } from "@koolee/ui";

import { submitBags } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "How many bags" };
export const dynamic = "force-dynamic";

export default async function BagsStepPage() {
  const draft = await readDraft();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">How many bags?</h1>
        <p className="text-sm text-muted-foreground">
          Each bag is weighed, sealed, and photographed before it leaves you. Your
          airline&apos;s own baggage fees and weight limits still apply at the bag drop.
        </p>
      </header>

      <StepForm action={submitBags} submitLabel="Continue">
        <div className="grid gap-2">
          <Label htmlFor="bagCount">Number of checked bags</Label>
          <select
            id="bagCount"
            name="bagCount"
            defaultValue={String(draft.bagCount ?? 1)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            required
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "bag" : "bags"}
              </option>
            ))}
          </select>
        </div>
      </StepForm>
    </div>
  );
}
