import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

import { signOutStaff } from "@/actions/auth";
import { signAvatarUrl } from "@/lib/avatars";
import { EnvStatus } from "@/components/env-status";
import { AgentMain } from "@/components/shell/agent-main";
import { getAgentIdentity } from "@/lib/session";

import { AvatarCard } from "./avatar-card";
import { NotificationsCard } from "./notifications-card";

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

  // Staff read any folder under 0027's policy, so the agent's own session
  // signs this — no service key exists in this app to fall back on.
  const avatarUrl = await signAvatarUrl(identity.avatarStoragePath);
  const displayName = identity.fullName ?? identity.email ?? null;

  return (
    <AgentMain>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-navy-800">Account</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-base">
            <Avatar size="sm" name={displayName} src={avatarUrl} alt="" />
            <span className="min-w-0 flex-1 truncate">
              {identity.fullName ?? identity.email ?? "Signed in"}
            </span>
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

      <AvatarCard currentUrl={avatarUrl} name={displayName} />

      {/* Above "Working offline" on purpose: this one has an action, and the
          offline card is a statement of fact. */}
      <NotificationsCard />

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
