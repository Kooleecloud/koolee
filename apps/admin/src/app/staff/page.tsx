import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listStaffMembers, type StaffMemberWithIdentity } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { DeactivateStaffButton, InviteStaffForm } from "./staff-forms";

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

  return (
    <ContentColumn>
      <PageHeader
        title="Staff"
        subtitle="Invite agents and admins, and revoke access. Accounts are invite-only."
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
            <ul className="flex flex-col gap-3">
              {staff.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-white p-4 shadow-xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {member.email ?? member.userId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {format(member.createdAt, "d MMM yyyy")}
                      {member.fullName ? ` · ${member.fullName}` : ""}
                    </span>
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
                    {member.active ? (
                      <DeactivateStaffButton userId={member.userId} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card className="h-fit">
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
    </ContentColumn>
  );
}
