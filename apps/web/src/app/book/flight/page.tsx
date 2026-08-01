import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@koolee/ui";

import { submitFlight } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "Your flight" };
export const dynamic = "force-dynamic";

export default async function FlightStepPage() {
  const draft = await readDraft();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your flight</h1>
        <p className="text-sm text-muted-foreground">
          We use your airline&apos;s bag-drop cutoff to work out which pickup windows can
          still get your bags there in time.
        </p>
      </header>

      <StepForm action={submitFlight} submitLabel="Continue">
        <div className="grid gap-2">
          <Label htmlFor="flightNumber">Flight number</Label>
          <Input
            id="flightNumber"
            name="flightNumber"
            placeholder="DL123"
            defaultValue={draft.flightNumber ?? ""}
            autoComplete="off"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="departureAirport">Departing from</Label>
          <select
            id="departureAirport"
            name="departureAirport"
            defaultValue={draft.departureAirport ?? "JFK"}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          >
            <option value="JFK">JFK — John F. Kennedy</option>
            <option value="LGA">LGA — LaGuardia</option>
            <option value="EWR">EWR — Newark Liberty</option>
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="departureAt">Departure date and time</Label>
          <Input
            id="departureAt"
            name="departureAt"
            type="datetime-local"
            defaultValue={draft.departureAt?.slice(0, 16) ?? ""}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="scope">Destination</Label>
          <select
            id="scope"
            name="scope"
            defaultValue={draft.scope ?? "domestic"}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="domestic">Domestic</option>
            <option value="international">International</option>
          </select>
          <p className="text-xs text-muted-foreground">
            International flights usually have an earlier bag-drop cutoff.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="paxName">Name on the ticket</Label>
          <Input
            id="paxName"
            name="paxName"
            placeholder="Jordan Alvarez"
            defaultValue={draft.paxName ?? ""}
            autoComplete="name"
            required
          />
          <p className="text-xs text-muted-foreground">
            Our agent checks this against your photo ID at pickup.
          </p>
        </div>
      </StepForm>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Upload your ticket instead</CardTitle>
          <CardDescription>
            Coming soon — we&apos;ll read the flight details off your e-ticket PDF.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" disabled>
            Upload ticket PDF
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
