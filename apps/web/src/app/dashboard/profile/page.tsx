import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@koolee/ui";
import { getCustomerById, listBookingsForSession } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

import { ConfirmEmailForm } from "./confirm-email-form";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/**
 * Account profile: editable display name; verified phone/email shown
 * read-only — changing those re-runs verification through the funnel's
 * guarded OTP path, never a second mechanism (see actions.ts).
 */
export default async function ProfilePage() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    redirect("/login?returnTo=%2Fdashboard%2Fprofile");
  }

  const core = tryGetCore();
  const userRow = core
    ? await getCustomerById(core.db, authUser.id).catch(() => null)
    : null;

  // Name prefills from the latest booking's passenger name — a nicety.
  let paxName = "";
  if (core && !userRow?.fullName) {
    try {
      const [latest] = await listBookingsForSession(
        core.db,
        customerSessionFromAuthUser(authUser),
        { limit: 1 },
      );
      if (latest) paxName = latest.paxName;
    } catch {
      // Empty form is fine.
    }
  }

  const phone = userRow?.phone ?? authUser.phone;
  const email = userRow?.email ?? authUser.email ?? "";
  const emailVerified = Boolean(userRow?.emailVerifiedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your profile"
        subtitle="Your verified contact details and how your name appears."
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verified contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Phone</span>
              <span className="flex items-center gap-2">
                {phone ?? <span className="text-muted-foreground">none</span>}
                {phone && userRow?.phoneVerifiedAt ? (
                  <Badge variant="success">
                    {/* Relative: an account milestone belongs to no booking,
                        so there is no airport zone to render it in. */}
                    verified {formatDistanceToNow(userRow.phoneVerifiedAt, {
                      addSuffix: true,
                    })}
                  </Badge>
                ) : null}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Email</span>
              <span className="flex items-center gap-2">
                {email || <span className="text-muted-foreground">none</span>}
                {email ? (
                  emailVerified ? (
                    <Badge variant="success">verified</Badge>
                  ) : (
                    <Badge variant="warning">confirmation pending</Badge>
                  )
                ) : null}
              </span>
            </div>
            {email && !emailVerified ? <ConfirmEmailForm email={email} /> : null}
            <p className="text-xs text-muted-foreground">
              Changing your phone or email means re-verifying it, the same way you did
              when booking. That flow lives in the booking verification step for now.
            </p>
          </CardContent>
        </Card>

        <ProfileForm
          defaults={{
            fullName: userRow?.fullName ?? paxName,
            email: emailVerified ? "" : email,
            emailLocked: Boolean(email),
          }}
        />
      </div>
    </div>
  );
}
