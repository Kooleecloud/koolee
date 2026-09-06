import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  EmptyState,
  FormSheet,
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
        actions={
          unavailable ? null : (
            <FormSheet
              trigger={
                <Button size="sm">
                  <Plus aria-hidden="true" />
                  Add a truck
                </Button>
              }
              title="Add a truck"
              description={
                <>
                  Bag capacity is what decides who a customer can pick, and reserved
                  spaces are <strong>held back from booking capacity</strong>: a van is
                  offered <em>capacity &minus; reserved &minus; bags already on board</em>
                  , so two spaces kept for a wheelchair or a fragile case stay empty.
                  Reserve fewer than the capacity &mdash; a van with nothing bookable
                  should be taken out of service instead.
                </>
              }
            >
              <AddTruckForm />
            </FormSheet>
          )
        }
      />

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
                    {/* Enforced now (slice F4). The number in brackets is
                          what a customer can actually be offered, which is the
                          question an operator is asking when they read this
                          line at all. */}
                    {truck.reservedSpaces > 0
                      ? ` · ${truck.reservedSpaces} held back — ${Math.max(
                          0,
                          truck.bagCapacity -
                            truck.reservedSpaces -
                            (truck.heldByUserId ? truck.bagsOnBoard : 0),
                        )} bookable`
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
    </ConsoleMain>
  );
}
