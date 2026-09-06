import Link from "next/link";
import {
  BackLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  PageHeader,
  PasswordResetForm,
} from "@koolee/ui";

import { TurnstileField } from "@/components/auth/turnstile-field";
import { sendPasswordReset } from "@/actions/auth";

export const metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <ContentColumn width="narrow">
      <BackLink href="/login" linkComponent={Link} className="self-start">
        Back to sign-in
      </BackLink>
      <PageHeader title="Reset your password" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email me a reset link</CardTitle>
          <CardDescription>
            We&apos;ll send a link that lets you choose a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordResetForm
            action={sendPasswordReset}
            captchaSlot={<TurnstileField />}
          />
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
