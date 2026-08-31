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
import { listTrucks, type TruckRow } from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { AddTruckForm, TruckRowForms } from "./truck-forms";

export const metadata = { title: "Trucks" };
export const dynamic = "force-dynamic";

/**
 * The fleet — a name and a bag capacity per vehicle.
 *
 * Capacity is the denominator of every driver-selection decision: a customer
 * is only offered a driver whose truck has room for their bags. Getting a
 * number wrong here quietly changes who customers can pick, which is why the
 * current load is shown next to it.
 *
 * Trucks are DEACTIVATED, never deleted — finished shifts reference them and
 * have to stay readable.
 */
export default async function TrucksPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let trucks: TruckRow[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      trucks = await listTrucks(core.db);
    } catch {
      unavailable = true;
    }
  }

  const active = trucks.filter((t) => t.active);
  const out = trucks.filter((t) => t.heldByUserId !== null);
  const totalCapacity = active.reduce((sum, t) => sum + t.bagCapacity, 0);

  return (
    <ConsoleMain>
      <PageHeader
        title="Trucks"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${active.length} in service · ${out.length} out right now · ${totalCapacity} bags of capacity`
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {unavailable ? (
            <DatabaseNotConfigured />
          ) : trucks.length === 0 ? (
            <EmptyState
              title="No trucks yet"
              description="Add the vans you actually run. A driver cannot start a shift without one, and a customer cannot choose a driver who is not on shift."
            />
          ) : (
            trucks.map((truck) => (
              <Card key={truck.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div className="flex flex-col gap-1.5">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {truck.name}
                      {!truck.active ? (
                        <Badge variant="secondary">Out of service</Badge>
                      ) : truck.heldByUserId ? (
                        <Badge variant="success">
                          Out with {truck.heldByName ?? "a driver"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Available</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {truck.heldByUserId
                        ? `${truck.bagsOnBoard} of ${truck.bagCapacity} bag spaces in use`
                        : `Holds ${truck.bagCapacity} bags`}
                      {truck.reservedSpaces > 0
                        ? ` · ${truck.reservedSpaces} reserved (not yet enforced)`
                        : ""}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <TruckRowForms
                    truck={{
                      id: truck.id,
                      name: truck.name,
                      bagCapacity: truck.bagCapacity,
                      reservedSpaces: truck.reservedSpaces,
                      active: truck.active,
                      heldByName: truck.heldByName,
                      bagsOnBoard: truck.bagsOnBoard,
                    }}
                  />
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a truck</CardTitle>
            <CardDescription>
              Bag capacity is what decides who a customer can pick. Reserved spaces are
              recorded but <strong>not yet enforced</strong> — nothing subtracts them from
              the space offered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddTruckForm />
          </CardContent>
        </Card>
      </div>
    </ConsoleMain>
  );
}
