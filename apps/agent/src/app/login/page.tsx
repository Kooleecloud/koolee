import { redirect } from "next/navigation";
import Link from "next/link";
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
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * Staff sign-in: email + password only, invite-only accounts. There is no
 * signup form here on purpose — see the boundary note in
 * `packages/core/src/services/staff.ts`.
 */
export default async function AgentLoginPage() {
  const session = await getAgentSession();
  if (session) redirect("/tasks");

  return (
    <ContentColumn width="narrow">
      <PageHeader title="Agent sign-in" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in with your staff account</CardTitle>
          <CardDescription>
            Agent accounts are created by invitation only. If you don&apos;t have one, ask
            an admin to invite you.
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

      <p className="text-center text-sm text-muted-foreground">
        Looking to book a pickup?{" "}
        <Link className="underline underline-offset-4" href="http://localhost:3000">
          That&apos;s the customer app.
        </Link>
      </p>
    </ContentColumn>
  );
}
