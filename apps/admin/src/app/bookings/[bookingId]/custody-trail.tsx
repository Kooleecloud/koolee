import { Avatar, Badge, CustodyTimeline, RawDataDisclosure } from "@koolee/ui";
import { formatInstantInAirportTz, type CustodyEvent } from "@koolee/core";

import { describeCustodyEvent } from "@/lib/custody-copy";

/**
 * The ops view of `custody_events` — the same shared timeline motif the
 * customer's trip page uses, with operator copy and the stored record kept
 * one click away.
 *
 * Seconds are in the timestamp on purpose: reconstructing a disputed hand-off
 * turns on the order of two events that can land in the same minute.
 *
 * ACTORS ARE PEOPLE NOW, not eight hex characters. Every line used to identify
 * whoever did the thing as `a3f19c02`, which meant reconstructing a hand-off
 * involved copying ids into the staff page one at a time. The trail is the
 * artefact somebody reads when a customer is disputing what happened, and a
 * name and a face are what make it readable at that moment.
 */
export interface CustodyActor {
  name: string | null;
  /** Short-lived signed URL, or null. `Avatar` falls back to initials. */
  avatarUrl: string | null;
}

export function CustodyTrail({
  events,
  signedUrls,
  actors,
  tz,
}: {
  events: CustodyEvent[];
  /** storage path → short-lived signed URL, for evidence photos. */
  signedUrls: Map<string, string>;
  /** actor user id → name and face. Missing ids fall back to the id itself. */
  actors: Map<string, CustodyActor>;
  /** The booking's display zone — the trail must agree with the window above it. */
  tz: string;
}) {
  return (
    <CustodyTimeline
      emptyMessage="No custody events yet."
      items={events.map((event, i) => {
        const { headline, details } = describeCustodyEvent(event, tz);
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
                /* A null actor is the SYSTEM, and that is information: a
                   payment capture has no person behind it, by design (the
                   agent app holds no payment credentials). */
                <Badge variant="secondary" className="text-[10px]">
                  system
                </Badge>
              )}
              {event.actorUserId ? <ActorChip actor={actors.get(event.actorUserId)} id={event.actorUserId} /> : null}
            </>
          ),
          meta: formatInstantInAirportTz(event.createdAt, tz),
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

/**
 * Who did it: a face, a name, and the id still one hover away.
 *
 * The id stays in the `title` rather than on screen. It is what you need when
 * you are reconciling against a log or a support ticket, and it is never what
 * you need when you are reading the trail.
 */
function ActorChip({ actor, id }: { actor: CustodyActor | undefined; id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={id}>
      <Avatar size="xs" name={actor?.name ?? null} src={actor?.avatarUrl ?? null} alt="" />
      <span className="text-[10px] text-muted-foreground">
        {actor?.name ?? <span className="font-mono">{id.slice(0, 8)}</span>}
      </span>
    </span>
  );
}
