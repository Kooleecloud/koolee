import { redirect } from "next/navigation";
import {
  Badge,
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
  formatWindowInAirportTz,
  getDisplayZones,
  listSlotBlocks,
  zoneFor,
  type SlotBlock,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { CreateBlockForm, RemoveBlockButton } from "./block-forms";

export const metadata = { title: "Window blocks" };
export const dynamic = "force-dynamic";

/**
 * Window blackouts. Pickup windows are virtual — every flight sees the same
 * hourly calendar — so THIS is the ops control over what customers can book:
 * a block hides every window it overlaps at that airport. Existing bookings
 * are untouched.
 */
export default async function BlocksPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();

  let blocks: SlotBlock[] = [];
  // Blocks are per airport, so each one renders in its own airport's zone.
  let zones: Record<string, string> = {};
  let unavailable = core === null;
  if (core) {
    try {
      // Only current + future blocks are actionable; history stays in the DB.
      [blocks, zones] = await Promise.all([
        listSlotBlocks(core, { from: new Date() }),
        getDisplayZones(core.db),
      ]);
    } catch {
      unavailable = true;
    }
  }

  return (
    <ContentColumn>
      <PageHeader
        title="Window blocks"
        subtitle="Hide pickup windows from customers — weather, driver shortage, holidays. Existing bookings in a blocked span are not affected."
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {unavailable ? (
            <DatabaseNotConfigured />
          ) : blocks.length === 0 ? (
            <EmptyState
              title="No upcoming blocks"
              description="Every pickup window is currently bookable. Add a block with the form."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {blocks.map((block) => (
                <Card asChild key={block.id}>
                  <li className="flex items-center justify-between gap-4 p-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {formatWindowInAirportTz(
                          block.blockStart,
                          block.blockEnd,
                          zoneFor(zones, block.airportCode),
                        )}
                      </span>
                      {block.reason ? (
                        <span className="text-xs text-muted-foreground">
                          {block.reason}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">{block.airportCode}</Badge>
                      <RemoveBlockButton id={block.id} />
                    </div>
                  </li>
                </Card>
              ))}
            </ul>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Block windows</CardTitle>
            <CardDescription>
              Hours are the airport&apos;s local time. Blocks take effect immediately —
              customers mid-funnel will see the window rejected at checkout.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBlockForm />
          </CardContent>
        </Card>
      </div>
    </ContentColumn>
  );
}
