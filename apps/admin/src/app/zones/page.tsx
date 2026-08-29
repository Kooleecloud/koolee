import { redirect } from "next/navigation";
import {
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
import {
  listActiveAgents,
  listAgentZones,
  type ActiveAgent,
  type AgentZoneCoverage,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { AddZonesForm, RemoveZoneButton } from "./zone-forms";

export const metadata = { title: "Agent zones" };
export const dynamic = "force-dynamic";

/**
 * Agent coverage by ZIP — the input auto-assignment picks candidates from.
 *
 * A ZIP with nobody on it is not an error and does not block a sale; it means
 * bookings there land unassigned on the board for a dispatcher to place. That
 * is why uncovered agents are listed too: an agent with no ZIPs is invisible
 * to auto-assign, and that should be obvious rather than inferred.
 */
export default async function ZonesPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let coverage: AgentZoneCoverage[] = [];
  let agents: ActiveAgent[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      [coverage, agents] = await Promise.all([
        listAgentZones(core.db),
        listActiveAgents(core.db),
      ]);
    } catch {
      unavailable = true;
    }
  }

  const zipsByAgent = new Map(coverage.map((row) => [row.agentUserId, row.zips]));
  const rows = agents.map((agent) => ({
    ...agent,
    zips: zipsByAgent.get(agent.userId) ?? [],
  }));
  const covered = new Set(coverage.flatMap((row) => row.zips));

  return (
    <ContentColumn>
      <PageHeader
        title="Agent zones"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${rows.length} active agent${rows.length === 1 ? "" : "s"} · ${covered.size} ZIP${covered.size === 1 ? "" : "s"} covered`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {unavailable ? (
            <DatabaseNotConfigured />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No active agents"
              description="Invite an agent on the Staff page, then give them ZIPs here."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((agent) => (
                <Card asChild key={agent.userId}>
                  <li className="flex flex-col gap-2 p-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {agent.fullName ?? agent.email ?? agent.userId}
                      </span>
                      {agent.fullName && agent.email ? (
                        <span className="text-xs text-muted-foreground">
                          {agent.email}
                        </span>
                      ) : null}
                    </div>
                    {agent.zips.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No ZIPs — auto-assign will never pick this agent.
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {agent.zips.map((zip) => (
                          <RemoveZoneButton
                            key={zip}
                            agentUserId={agent.userId}
                            zip={zip}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                </Card>
              ))}
            </ul>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Assign ZIPs</CardTitle>
            <CardDescription>
              Auto-assign picks the covering agent with the fewest clashing tasks.
              Coverage changes apply to the next booking, never to one already assigned.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddZonesForm
              agents={rows.map((agent) => ({
                userId: agent.userId,
                label: agent.fullName
                  ? `${agent.fullName} (${agent.email ?? agent.userId})`
                  : (agent.email ?? agent.userId),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </ContentColumn>
  );
}
