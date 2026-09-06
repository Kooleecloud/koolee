import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { UserPlus } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DatabaseNotConfigured,
  EmptyState,
  FormSheet,
  PageHeader,
} from "@koolee/ui";
import {
  listStaffMembers,
  listStaffWorkloadToday,
  type StaffMemberWithIdentity,
  type StaffWorkloadToday,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { signAvatarUrls } from "@/lib/avatars";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { DeactivateStaffButton, InviteStaffForm } from "./staff-forms";
import { StaffFilters } from "./staff-filters";
import { StaffPhotoDialog } from "./staff-photo-dialog";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/**
 * Staff management: list, invite, deactivate — exactly these three
 * capabilities (v1 scope, deliberately no reactivate/edit/delete here).
 */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ driving?: string; show?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const { driving, show } = await searchParams;
  /*
   * FILTERS IN THE URL, like the bookings board. A roster somebody is looking
   * at should be a link they can send to whoever is covering next, and it
   * keeps this page a server component with no state to synchronise.
   */
  const drivingOnly = driving === "1";
  const showing: "active" | "all" = show === "all" ? "all" : "active";

  const core = tryGetCore();

  let staff: StaffMemberWithIdentity[] = [];
  let workload: StaffWorkloadToday[] = [];
  let unavailable = core === null;

  /*
   * The console's own day. Deliberately the SERVER's midnight rather than a
   * booking's airport zone: this is "how busy is this person today" for an
   * operator sitting in one place, not a schedule. See the service's header.
   */
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  if (core) {
    try {
      staff = await listStaffMembers(core.db);
      /*
       * Derived from task rows, never bookkept — see `listStaffWorkloadToday`.
       * Degrades to an empty map rather than failing the page: a roster an
       * operator opened to deactivate somebody must not be blocked by the
       * column that says how busy they are.
       */
      workload = await listStaffWorkloadToday(core.db, dayStart, dayEnd).catch(() => []);
    } catch {
      unavailable = true;
    }
  }

  const workloadByUser = new Map(workload.map((row) => [row.staffUserId, row]));

  // One batched signing call for the whole table, not one per row.
  const avatarUrls = await signAvatarUrls(staff.map((m) => m.avatarStoragePath));

  /*
   * GROUPED BY ROLE, because they are two different lists that happened to
   * share a table. An agent is somebody you dispatch; an admin is somebody
   * with console access. Sorted by `createdAt`, the roster interleaved them,
   * so "who can I send to a door" meant reading every row and filtering by
   * eye.
   *
   * FILTERED IN MEMORY rather than by a second query: the roster is a
   * bounded list — sixteen rows here, and a hundred would still be one page —
   * and a WHERE clause per toggle would be three round trips for a filter a
   * human applies to a list they can already see.
   */
  const visible = staff.filter((member) => {
    if (showing === "active" && !member.active) return false;
    if (drivingOnly && !member.canDrive) return false;
    return true;
  });
  const groups = [
    {
      role: "agent" as const,
      label: "Agents",
      members: visible.filter((m) => m.role === "agent"),
    },
    {
      role: "admin" as const,
      label: "Admins",
      members: visible.filter((m) => m.role === "admin"),
    },
  ];

  return (
    <ConsoleMain>
      <PageHeader
        title="Staff"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${staff.filter((member) => member.active).length} active of ${staff.length} · invite-only. Agents land in the agent app, admins here.`
        }
        /*
         * THE FORM MOVED BEHIND A NAMED BUTTON. It used to sit pinned down the
         * right in a `2fr 1fr` grid, so the roster — the thing an operator
         * opens this page to read — rendered in two thirds of the width it
         * had, with a blank form beside it, all day. Inviting somebody is an
         * occasional act; reading the roster is why the page exists.
         */
        actions={
          unavailable ? null : (
            <FormSheet
              trigger={
                <Button size="sm">
                  <UserPlus aria-hidden="true" />
                  Invite
                </Button>
              }
              title="Invite staff"
              description="They'll receive an email link to set a password. Agents land in the agent app, admins here."
            >
              <InviteStaffForm />
            </FormSheet>
          )
        }
      />

      {!unavailable && (
        <StaffFilters
          drivingOnly={drivingOnly}
          showing={showing}
          counts={{ shown: visible.length, total: staff.length }}
        />
      )}

      <section className="flex flex-col gap-6">
        {unavailable ? (
          <DatabaseNotConfigured />
        ) : staff.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Invite your first agent or admin — the button is above."
          />
        ) : visible.length === 0 ? (
          /* The filters, not the roster, are why this is empty — and saying
             so is the difference between "nobody matches" and "nobody here". */
          <EmptyState
            title="Nobody matches these filters"
            description="There are people on the roster; none of them fit what you have selected."
          />
        ) : (
          groups.map((group) =>
            group.members.length === 0 ? null : (
              <div key={group.role} className="flex flex-col gap-3">
                <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {group.label} · {group.members.length}
                </h2>
                <ul className="console-rows flex flex-col gap-3">
                  {group.members.map((member) => (
                    <Card asChild key={member.id}>
                      <li className="flex items-center justify-between gap-4 p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar
                            size="md"
                            name={member.fullName ?? member.email}
                            src={
                              member.avatarStoragePath
                                ? (avatarUrls.get(member.avatarStoragePath) ?? null)
                                : null
                            }
                            alt=""
                            // A deactivated operator still has a face; dimming it
                            // is how the row says so without a second badge.
                            className={member.active ? undefined : "opacity-50"}
                          />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            {/* The name is the way in to this person's work
                            history — counts, tasks and shifts — which used to
                            be reachable only by cross-referencing ids by
                            hand across three pages. */}
                            <Link
                              href={`/staff/${member.userId}`}
                              className="truncate font-medium text-navy-800 underline decoration-transparent underline-offset-4 transition-colors hover:decoration-sky-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {member.fullName ?? member.email ?? member.userId}
                            </Link>
                            <span className="truncate text-xs text-muted-foreground">
                              {/* The name moved up to the primary line, so the
                            email — the thing an invite is actually addressed
                            to — takes its place here. Relative time: a staff
                            record belongs to no booking, so there is no
                            airport zone to render it in. */}
                              {member.fullName && member.email
                                ? `${member.email} · `
                                : ""}
                              Added{" "}
                              {formatDistanceToNow(member.createdAt, { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {/*
                            WHAT THEY HAVE ON TODAY, counted by BOOKING rather
                            than by task — one person holds both the
                            verification and the pickup task for the same trip,
                            so counting tasks would report six jobs for three
                            addresses. Derived on every read; nothing bookkept.
                          */}
                          <StaffWorkloadCell
                            workload={workloadByUser.get(member.userId)}
                          />
                          <Badge
                            variant={member.role === "admin" ? "default" : "secondary"}
                          >
                            {member.role}
                          </Badge>
                          {member.active ? (
                            <Badge variant="success">active</Badge>
                          ) : (
                            <Badge variant="warning">deactivated</Badge>
                          )}
                          {/* An admin may replace any staff photo — see
                          `canReplaceAvatarOf`. A customer's photo is
                          deliberately out of reach from here. */}
                          <StaffPhotoDialog
                            userId={member.userId}
                            name={member.fullName ?? member.email}
                            currentUrl={
                              member.avatarStoragePath
                                ? (avatarUrls.get(member.avatarStoragePath) ?? null)
                                : null
                            }
                          />
                          {member.active ? (
                            <DeactivateStaffButton userId={member.userId} />
                          ) : null}
                        </div>
                      </li>
                    </Card>
                  ))}
                </ul>
              </div>
            ),
          )
        )}
      </section>
    </ConsoleMain>
  );
}

/**
 * One person's day, in the width of a table cell.
 *
 * Absent when they have nothing on: a row of "0 today" down a roster is noise
 * on everybody who is not working, and the empty space says it more quietly.
 * The in-progress booking is a LINK, because "who is on what right now" is
 * always followed by "show me".
 */
function StaffWorkloadCell({ workload }: { workload?: StaffWorkloadToday }) {
  if (!workload || workload.assigned === 0) return null;

  return (
    <span className="hidden flex-col items-end gap-0.5 text-xs sm:flex">
      <span className="text-muted-foreground">{workload.assigned} today</span>
      {workload.inProgress ? (
        <Link
          href={`/bookings/${workload.inProgress.bookingId}`}
          className="font-mono text-navy-800 underline decoration-transparent underline-offset-4 transition-colors hover:decoration-sky-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {workload.inProgress.ref}
        </Link>
      ) : null}
    </span>
  );
}
