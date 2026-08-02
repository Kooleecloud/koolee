import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  PageHeader,
} from "@koolee/ui";

import { tryGetAdminSession } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const result = await tryGetAdminSession();

  return (
    <ContentColumn width="narrow">
      <PageHeader title="Sign in" />

      {"error" in result ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Sign-in is not implemented</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Admins can force state transitions and issue refunds. Real SSO, a second
            factor, and an audit trail are required before this console is reachable — see{" "}
            <code>packages/core/src/auth/stubs.ts</code>.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>Development session</span>
              <Badge variant="warning">dev only</Badge>
            </CardTitle>
            <CardDescription>
              You are signed in as a stub admin. No credentials were checked.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono text-xs">{result.session?.userId}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{result.session?.role}</dd>
            </dl>
            <Button asChild>
              <Link href="/bookings">Go to bookings</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </ContentColumn>
  );
}
