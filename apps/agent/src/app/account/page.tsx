import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

import { signOutStaff } from "@/actions/auth";
import { EnvStatus } from "@/components/env-status";
import { AgentMain } from "@/components/shell/agent-main";
import { getAgentIdentity } from "@/lib/session";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/**
 * Account — who you are, and the way out.
 *
 * This tab exists mostly to get Sign out off every other screen. It used to
 * sit in the top-right of the header, which on a phone is where a thumb rests
 * and where "back" lives in every other app a driver uses. Ending a session
 * mid-shift because you meant to go back is a bad afternoon.
 *
 * The dev environment card also moves here from the home screen, where it was
 * taking two thirds of the first thing a driver saw.
 */
export default async function AccountPage() {
  const identity = await getAgentIdentity();
  if (!identity) redirect("/login");

  return (
    <AgentMain>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-navy-800">Account</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="min-w-0 truncate">{identity.email ?? "Signed in"}</span>
            <Badge variant="secondary">agent</Badge>
          </CardTitle>
          <CardDescription>
            Every seal, photo and hand-off you record is filed under this account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOutStaff}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Working offline</CardTitle>
          <CardDescription>
            Tasks and custody events need a connection. If you lose signal mid-visit,
            nothing you typed is submitted — reconnect and the step you were on is still
            there, waiting.
          </CardDescription>
        </CardHeader>
      </Card>

      <EnvStatus appName="agent" />
    </AgentMain>
  );
}
