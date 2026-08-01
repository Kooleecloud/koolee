import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

import { tryGetAgentSession } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function AgentLoginPage() {
  const result = await tryGetAgentSession();

  return (
    <main className="container flex max-w-md flex-col gap-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

      {"error" in result ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Sign-in is not implemented</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Real agent authentication is deliberately unbuilt. See{" "}
            <code>packages/core/src/auth/stubs.ts</code> for the requirements that must be
            met before this app is exposed beyond localhost.
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
              You are signed in as a stub agent. No credentials were checked.
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
              <Link href="/tasks">Go to my tasks</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
