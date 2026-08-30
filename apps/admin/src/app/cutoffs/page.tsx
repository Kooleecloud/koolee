import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listAirlineCutoffs, type AirlineCutoffRow } from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { AddCutoffForm, CutoffRowForm } from "./cutoff-forms";
import { CutoffFilters } from "./cutoff-filters";

export const metadata = { title: "Airline cutoffs" };
export const dynamic = "force-dynamic";

/**
 * How late each airline takes checked bags.
 *
 * THE MOST SAFETY-CRITICAL DATA IN THE PRODUCT, and until Tier 5 there was no
 * way to correct a row but SQL. Every sellable pickup window is derived from
 * these numbers; one set too generously sells a booking that cannot make its
 * flight, and nothing downstream can catch that.
 *
 * The seed writes 128 rows at a flat 45 (domestic) / 60 (international)
 * minutes, each stamped as a placeholder. The count at the top of this page is
 * therefore a launch-readiness number, not a statistic: it says how much of the
 * matrix is still the seed's invention.
 */
const AIRPORTS = ["JFK", "LGA", "EWR"] as const;
type Airport = (typeof AIRPORTS)[number];

function isAirport(value: string): value is Airport {
  return (AIRPORTS as readonly string[]).includes(value);
}

export default async function CutoffsPage({
  searchParams,
}: {
  searchParams: Promise<{ airport?: string; unverified?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const airport = params.airport && isAirport(params.airport) ? params.airport : "";
  const unverifiedOnly = params.unverified === "1";

  const core = tryGetCore();
  let rows: AirlineCutoffRow[] = [];
  let total = 0;
  let placeholders = 0;
  let unavailable = core === null;

  if (core) {
    try {
      // The counts are of the WHOLE matrix, never of what is filtered: "128 of
      // 128 unverified" is the launch-readiness number, and a filter that
      // changed it would be a number that lies depending on where you are
      // standing.
      const all = await listAirlineCutoffs(core.db);
      total = all.total;
      placeholders = all.placeholders;
      rows = all.rows.filter(
        (row) =>
          (airport === "" || row.airportCode === airport) &&
          (!unverifiedOnly || row.placeholder),
      );
    } catch {
      unavailable = true;
    }
  }

  const byAirport = new Map<string, AirlineCutoffRow[]>();
  for (const row of rows) {
    const group = byAirport.get(row.airportCode);
    if (group) group.push(row);
    else byAirport.set(row.airportCode, [row]);
  }

  return (
    <ConsoleMain>
      <PageHeader
        title="Airline cutoffs"
        subtitle={
          unavailable
            ? "Database not configured."
            : placeholders === 0
              ? `${total} rows, all verified.`
              : `${placeholders} of ${total} rows are still the seed's placeholder. Every sellable pickup window is derived from these.`
        }
      />

      {unavailable ? null : (
        <div className="mb-6">
          <CutoffFilters airport={airport} unverifiedOnly={unverifiedOnly} />
        </div>
      )}

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : rows.length === 0 ? (
        <EmptyState
          title={total === 0 ? "No cutoffs on record" : "Nothing matches those filters"}
          description={
            total === 0
              ? "Koolee refuses to sell a pickup for an airline it has no cutoff for, so this page being empty means nothing can be booked."
              : unverifiedOnly
                ? "Every row in this view has a real source on it. That is the state this page exists to reach."
                : "Try another airport."
          }
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
          <section className="flex flex-col gap-6">
            {[...byAirport.entries()].map(([airport, group]) => {
              const unverified = group.filter((row) => row.placeholder).length;
              return (
                <Card key={airport}>
                  <CardHeader className="gap-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {airport}
                      {unverified > 0 ? (
                        <Badge variant="secondary">{unverified} unverified</Badge>
                      ) : (
                        <Badge variant="success">All verified</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {group.length} rows. A booking takes the STRICTEST row on record
                      across scopes — bookings do not store domestic or international, and
                      a deadline that runs early costs the customer nothing.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y divide-border">
                    {group.map((row) => (
                      <CutoffRowForm
                        key={row.id}
                        row={{
                          id: row.id,
                          airlineIata: row.airlineIata,
                          airportCode: row.airportCode,
                          scope: row.scope,
                          minutes: row.cutoffMinutesBeforeDeparture,
                          source: row.source,
                          placeholder: row.placeholder,
                        }}
                      />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add an airline</CardTitle>
              <CardDescription>
                For a carrier the seed never knew about. Without a row, Koolee refuses to
                sell that airline at that airport at all — which is the right default, and
                this is how it stops being permanent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddCutoffForm />
            </CardContent>
          </Card>
        </div>
      )}
    </ConsoleMain>
  );
}
