import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  PageHeader,
  SetPasswordForm,
} from "@koolee/ui";

import { updatePassword } from "@/actions/auth";

export const metadata = { title: "Set password" };
export const dynamic = "force-dynamic";

/**
 * Landing page for invite-acceptance and password-recovery links (the
 * /auth/callback route signs the user in first, then sends them here).
 */
export default function SetPasswordPage() {
  return (
    <ContentColumn width="narrow">
      <PageHeader title="Choose a password" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set your password</CardTitle>
          <CardDescription>
            You&apos;ll use it with your email to sign in from now on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm action={updatePassword} />
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
