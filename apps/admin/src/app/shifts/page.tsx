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
import {
  formatInstantInAirportTz,
  listOnBehalfDriverOptions,
  listShifts,
  listTruckOptions,
  listStaffMembers,
  type ShiftRow,
  type StaffMemberWithIdentity,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { CanDriveToggle, ForceEndShiftForm, StartShiftOnBehalfForm } from "./shift-forms";

export const metadata = { title: "Shifts" };
export const dynamic = "force-dynamic";

/**
 * Who is out driving, in what, with how many bags.
 *
 * Recent CLOSED shifts are listed under the open ones because the second
 * question after "who is out" is "who just finished" — a driver who clocked
 * off ten minutes ago is still the person to call about the run they just did.
 *
 * Times render in the console's zone (`OPS_CONSOLE_TZ`) rather than per
 * booking, because a shift belongs to a person's day rather than to any one
 * flight. Every airport Koolee serves is Eastern; the constant is the place to
 * change when that stops being true.
 */
export default async function ShiftsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let shifts: ShiftRow[] = [];
  let staff: StaffMemberWithIdentity[] = [];
  let onBehalfDrivers: Awaited<ReturnType<typeof listOnBehalfDriverOptions>> = [];
  let onBehalfTrucks: Awaited<ReturnType<typeof listTruckOptions>> = [];
  let unavailable = core === null;

  if (core) {
    try {
      [shifts, staff, onBehalfDrivers, onBehalfTrucks] = await Promise.all([
        listShifts(core.db, { limit: 40 }),
        listStaffMembers(core.db),
        listOnBehalfDriverOptions(core.db),
        listTruckOptions(core.db),
      ]);
    } catch {
      unavailable = true;
    }
  }

  const open = shifts.filter((s) => s.endedAt === null);
  const recent = shifts.filter((s) => s.endedAt !== null);
  const drivers = staff.filter((s) => s.active && s.role === "agent");
  const bagsOut = open.reduce((sum, s) => sum + s.bagsOnBoard, 0);

  const nameOf = (shift: ShiftRow) =>
    shift.staffName?.trim() || shift.staffEmail || "Unnamed driver";

  return (
    <ConsoleMain>
      <PageHeader
        title="Shifts"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${open.length} out right now · ${bagsOut} bag${bagsOut === 1 ? "" : "s"} on the road`
        }
      />

      {/*
        Above the list, because it is what an operator came here to DO when
        the list is empty — and "nobody is out" is exactly when the console
        needed to be able to put somebody out.
      */}
      {!unavailable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start a shift for someone</CardTitle>
            <CardDescription>
              For a driver whose phone is dead, whose account is locked out, or whose app
              will not load. The same rules apply as when they start it themselves, and
              you are recorded as having opened it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StartShiftOnBehalfForm
              drivers={onBehalfDrivers.map((driver) => ({
                staffUserId: driver.staffUserId,
                label: driver.name?.trim() || driver.email || "Unnamed driver",
                busyWith: driver.activeShiftTruckName,
              }))}
              trucks={onBehalfTrucks.map((truck) => ({
                id: truck.id,
                name: truck.name,
                held: truck.heldByUserId !== null,
              }))}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {unavailable ? (
            <DatabaseNotConfigured />
          ) : open.length === 0 ? (
            <EmptyState
              title="Nobody is out"
              description="A driver starts their own shift from the field app, or you start one for them above. Until somebody is out, no customer can be offered a driver — sealed bookings will show as awaiting a driver on the board."
            />
          ) : (
            open.map((shift) => {
              const remaining = shift.bagCapacity - shift.bagsOnBoard;
              return (
                <Card key={shift.shiftId}>
                  <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div className="flex flex-col gap-1.5">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {nameOf(shift)}
                        <Badge variant="success">On shift</Badge>
                      </CardTitle>
                      <CardDescription>
                        {shift.truckName} · {shift.bagsOnBoard} of {shift.bagCapacity} bag
                        {shift.bagCapacity === 1 ? "" : "s"} used ({remaining} free) ·
                        started{" "}
                        {formatInstantInAirportTz(shift.startedAt, OPS_CONSOLE_TZ)}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ForceEndShiftForm
                      shiftId={shift.shiftId}
                      driverName={nameOf(shift)}
                      bagsOnBoard={shift.bagsOnBoard}
                    />
                  </CardContent>
                </Card>
              );
            })
          )}

          {recent.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recently finished</CardTitle>
                <CardDescription>
                  The last {recent.length} shift{recent.length === 1 ? "" : "s"} to end.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {recent.map((shift) => (
                    <li
                      key={shift.shiftId}
                      className="flex flex-wrap gap-x-2 text-muted-foreground"
                    >
                      <span className="font-medium text-navy-800">{nameOf(shift)}</span>
                      <span>{shift.truckName}</span>
                      <span>
                        {formatInstantInAirportTz(shift.startedAt, OPS_CONSOLE_TZ)} →{" "}
                        {shift.endedAt
                          ? formatInstantInAirportTz(shift.endedAt, OPS_CONSOLE_TZ)
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who may drive</CardTitle>
            <CardDescription>
              Driving is a capability, not a role — the same person can verify at the door
              and drive the van. A revoked grant takes effect on their next request; it
              does not end a shift already under way.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active agents. Invite one on the Staff page first.
              </p>
            ) : (
              drivers.map((member) => (
                <div key={member.id} className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {member.fullName?.trim() || member.email}
                    </span>
                    {member.canDrive ? (
                      <Badge variant="success">Can drive</Badge>
                    ) : (
                      <Badge variant="outline">Verification only</Badge>
                    )}
                  </span>
                  <CanDriveToggle
                    userId={member.userId}
                    name={member.fullName?.trim().split(/\s+/)[0] ?? "them"}
                    canDrive={member.canDrive}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </ConsoleMain>
  );
}
