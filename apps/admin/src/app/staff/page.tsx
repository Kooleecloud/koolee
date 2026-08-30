import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Avatar,
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
import { listStaffMembers, type StaffMemberWithIdentity } from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { signAvatarUrls } from "@/lib/avatars";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { DeactivateStaffButton, InviteStaffForm } from "./staff-forms";
import { StaffPhotoDialog } from "./staff-photo-dialog";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/**
 * Staff management: list, invite, deactivate — exactly these three
 * capabilities (v1 scope, deliberately no reactivate/edit/delete here).
 */
export default async function StaffPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();

  let staff: StaffMemberWithIdentity[] = [];
  let unavailable = core === null;
  if (core) {
    try {
      staff = await listStaffMembers(core.db);
    } catch {
      unavailable = true;
    }
  }

  // One batched signing call for the whole table, not one per row.
  const avatarUrls = await signAvatarUrls(staff.map((m) => m.avatarStoragePath));

  return (
    <ConsoleMain>
      <PageHeader
        title="Staff"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${staff.filter((member) => member.active).length} active of ${staff.length} · invite-only. Agents land in the agent app, admins here.`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {unavailable ? (
            <DatabaseNotConfigured />
          ) : staff.length === 0 ? (
            <EmptyState
              title="No staff yet"
              description="Invite your first agent or admin with the form."
            />
          ) : (
            <ul className="console-rows flex flex-col gap-3">
              {staff.map((member) => (
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
                          {member.fullName && member.email ? `${member.email} · ` : ""}
                          Added{" "}
                          {formatDistanceToNow(member.createdAt, { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={member.role === "admin" ? "default" : "secondary"}>
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
          )}
        </section>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-base">Invite staff</CardTitle>
            <CardDescription>
              They&apos;ll receive an email link to set a password. Agents land in the
              agent app, admins here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteStaffForm />
          </CardContent>
        </Card>
      </div>
    </ConsoleMain>
  );
}
