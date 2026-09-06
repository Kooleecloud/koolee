import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  PageHeader,
  StaffLoginForm,
} from "@koolee/ui";

import { TurnstileField } from "@/components/auth/turnstile-field";
import { signInStaff } from "@/actions/auth";
import { getAdminSession } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * Staff sign-in: email + password only, invite-only accounts. There is no
 * signup form here on purpose — see the boundary note in
 * `packages/core/src/services/staff.ts`.
 */
export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/");

  return (
    <ContentColumn width="narrow">
      <PageHeader title="Ops sign-in" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in with your staff account</CardTitle>
          <CardDescription>
            Admin accounts are created by invitation only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffLoginForm
            action={signInStaff}
            resetHref="/login/reset"
            captchaSlot={<TurnstileField />}
          />
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
