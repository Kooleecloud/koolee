import { redirect } from "next/navigation";
import { format } from "date-fns";
import { FormMessage, Input, Label, PageHeader, Select } from "@koolee/ui";

import { submitFlight } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { TicketUpload } from "@/components/ticket-upload";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "Your flight" };
export const dynamic = "force-dynamic";

export default async function FlightStepPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const draft = await readDraft();
  if (!draft.zip) redirect("/book/zip");

  const { from } = await searchParams;
  const fromTicket = from === "ticket";

  const departureAtDefault = draft.departureAt
    ? format(new Date(draft.departureAt), "yyyy-MM-dd'T'HH:mm")
    : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fromTicket ? "Review your flight details" : "Your flight"}
        subtitle={
          fromTicket
            ? "Here's what we read from your ticket — check every field before continuing."
            : "We use your airline's bag-drop cutoff to work out which pickup windows can still get your bags there in time."
        }
      />

      {fromTicket && (
        <FormMessage variant="info">
          We filled this in from your e-ticket. Nothing is booked until you review and
          continue.
        </FormMessage>
      )}

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
          <Select
            id="departureAirport"
            name="departureAirport"
            defaultValue={draft.departureAirport ?? "JFK"}
            required
          >
            <option value="JFK">JFK — John F. Kennedy</option>
            <option value="LGA">LGA — LaGuardia</option>
            <option value="EWR">EWR — Newark Liberty</option>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="departureAt">Departure date and time</Label>
          <Input
            id="departureAt"
            name="departureAt"
            type="datetime-local"
            defaultValue={departureAtDefault}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="scope">Destination</Label>
          <Select id="scope" name="scope" defaultValue={draft.scope ?? "domestic"}>
            <option value="domestic">Domestic</option>
            <option value="international">International</option>
          </Select>
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

      <TicketUpload />
    </div>
  );
}
