import { format } from "date-fns";
import { Badge, CustodyTimeline, RawDataDisclosure } from "@koolee/ui";
import type { CustodyEvent } from "@koolee/core";

import { describeCustodyEvent } from "@/lib/custody-copy";

/**
 * The ops view of `custody_events` — the same shared timeline motif the
 * customer's trip page uses, with operator copy and the stored record kept
 * one click away.
 *
 * Seconds are in the timestamp on purpose: reconstructing a disputed hand-off
 * turns on the order of two events that can land in the same minute.
 */
export function CustodyTrail({
  events,
  signedUrls,
}: {
  events: CustodyEvent[];
  /** storage path → short-lived signed URL, for evidence photos. */
  signedUrls: Map<string, string>;
}) {
  return (
    <CustodyTimeline
      emptyMessage="No custody events yet."
      items={events.map((event, i) => {
        const { headline, details } = describeCustodyEvent(event);
        return {
          id: event.id,
          title: headline,
          badge: (
            <>
              {event.actorRole ? (
                <Badge variant="outline" className="text-[10px]">
                  {event.actorRole}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  system
                </Badge>
              )}
              {event.actorUserId ? (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  title={event.actorUserId}
                >
                  {event.actorUserId.slice(0, 8)}
                </span>
              ) : null}
            </>
          ),
          meta: format(event.createdAt, "d MMM yyyy, HH:mm:ss"),
          metaDateTime: event.createdAt.toISOString(),
          ...(event.photoUrl && signedUrls.has(event.photoUrl)
            ? { photoUrl: signedUrls.get(event.photoUrl), photoAlt: "Custody evidence" }
            : {}),
          description: (
            <span className="flex flex-col gap-1">
              {details.length > 0 && <span>{details.join(" · ")}</span>}
              {event.metadata != null && <RawDataDisclosure data={event.metadata} />}
            </span>
          ),
          state: i === events.length - 1 ? ("current" as const) : ("complete" as const),
        };
      })}
    />
  );
}
