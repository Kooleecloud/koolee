import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, Navigation, Phone, TriangleAlert } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DatabaseNotConfigured,
  formatE164ForDisplay,
} from "@koolee/ui";
import {
  dstTransitionNote,
  formatHourRangeInAirportTz,
  formatInstantInAirportTz,
  getBookingActionability,
  getPickupContext,
  getVisitContext,
  VISIT_EVENT_TYPES,
  type BookingActionability,
  type TaskKind,
  type VisitContext,
} from "@koolee/core";

import { LiveTasks } from "@/components/live-tasks";
import { AgentMain } from "@/components/shell/agent-main";
import { tryGetCore } from "@/lib/core";
import { signAvatarUrl } from "@/lib/avatars";
import { signPassportPhotoUrl } from "@/lib/passport-photos";
import { getAgentSession } from "@/lib/session";

import { PickupFlow, type PickupView } from "./pickup-flow";
import { VisitFlow, type VisitView } from "./visit-flow";

export const dynamic = "force-dynamic";

/** Back to the list, sized for a thumb rather than a mouse. */
function BackToToday() {
  return (
    <Link
      href="/"
      className="inline-flex h-9 items-center gap-1.5 self-start rounded-md pr-3 text-sm font-medium text-muted-foreground transition-colors hover:text-navy-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Today
    </Link>
  );
}

/**
 * The doorstep header.
 *
 * This is the block that was missing entirely. A driver opening a visit was
 * shown a title, a ref, a flight number and a departure time — and not the
 * address they were driving to or the number of the person they were meeting.
 * Both are now the first thing on the screen, each one tap from acting on it.
 */
/**
 * The fields the doorstep header reads. Both `VisitContext` and
 * `PickupContext` satisfy it — the same person drives to the same door for
 * both halves of the job, so the header is one component rather than two that
 * drift.
 */
interface DoorstepContext {
  booking: VisitContext["booking"];
  task: { scheduledStart: Date | null; scheduledEnd: Date | null };
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    zip: string | null;
    placeId: string | null;
  } | null;
  customer: { fullName: string | null; avatarStoragePath: string | null } | null;
  tz: string;
}

function DoorstepCard({
  context,
  customerAvatarUrl,
}: {
  context: DoorstepContext;
  /** Signed as this agent — staff read any folder under 0027's policy. */
  customerAvatarUrl: string | null;
}) {
  const { booking, task, address, customer, tz } = context;
  const windowNote = task.scheduledStart
    ? dstTransitionNote(task.scheduledStart, tz)
    : null;

  const addressLine = address
    ? [
        address.line1,
        address.line2,
        address.city,
        [address.state, address.zip].filter(Boolean).join(" "),
      ]
        .filter((part) => part && part.length > 0)
        .join(", ")
    : null;

  const mapsHref = addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}${
        address?.placeId ? `&query_place_id=${encodeURIComponent(address.placeId)}` : ""
      }`
    : null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        {/* Window first, name second: the driver already knows roughly who,
            and is checking whether they are on time. */}
        <span className="font-display text-2xl font-semibold text-navy-800">
          {task.scheduledStart
            ? task.scheduledEnd
              ? formatHourRangeInAirportTz(task.scheduledStart, task.scheduledEnd, tz)
              : formatInstantInAirportTz(task.scheduledStart, tz)
            : "Unscheduled"}
        </span>
        {/* The face goes next to the name, not above the window: the driver
            reads this card in the van to check they are on time, and again at
            the door to check they have the right person. Same card, two jobs. */}
        <span className="flex items-center gap-2">
          <Avatar
            size="sm"
            name={customer?.fullName ?? booking.paxName}
            src={customerAvatarUrl}
            alt=""
          />
          <span className="text-base font-medium">{booking.paxName}</span>
        </span>
        {windowNote ? (
          <span className="text-xs text-muted-foreground">{windowNote}</span>
        ) : null}
      </div>

      {addressLine ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{addressLine}</span>
        </p>
      ) : (
        <p className="text-sm text-warning-foreground">
          No address on file — call ops before going anywhere.
        </p>
      )}

      <div className="flex gap-2">
        {mapsHref ? (
          <Button asChild variant="outline" size="lg" className="flex-1">
            <a href={mapsHref} target="_blank" rel="noopener noreferrer">
              <Navigation aria-hidden="true" />
              Navigate
            </a>
          </Button>
        ) : null}
        {booking.contactPhone ? (
          <Button asChild variant="outline" size="lg" className="flex-1">
            <a href={`tel:${booking.contactPhone}`}>
              <Phone aria-hidden="true" />
              Call
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="lg" className="flex-1" disabled>
            <Phone aria-hidden="true" />
            No number
          </Button>
        )}
      </div>
      {booking.contactPhone ? (
        <span className="sr-only">
          Contact number {formatE164ForDisplay(booking.contactPhone)}
        </span>
      ) : null}

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="font-mono">{booking.ref}</span> · {booking.bagCount} bag
        {booking.bagCount === 1 ? "" : "s"} · {booking.flightNumber} ·{" "}
        {booking.departureAirport} · departs{" "}
        {formatInstantInAirportTz(booking.departureAt, tz)}
      </p>
    </Card>
  );
}

/**
 * What the gates decided, at the top of the screen the agent is looking at.
 *
 * Two states, and the difference between them is the whole point: "running
 * late" sits above controls that STILL WORK, because a visit before the
 * airline's bag drop closes is a visit worth making. "Blocked" sits above
 * controls that will refuse, and says why — an agent who taps Arrive and gets
 * a server error learns nothing they can act on, and neither does the
 * customer standing in front of them.
 */
function ActionabilityNotice({ state }: { state: BookingActionability }) {
  const blocked = state.blockedReason !== null;
  const message = state.blockedReason ?? state.lateNotice;
  if (!message) return null;

  return (
    <div
      role="status"
      className={
        blocked
          ? "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          : "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      }
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { taskId } = await params;
  const { kind: rawKind = "verification" } = await searchParams;
  const kind: TaskKind = rawKind === "pickup" ? "pickup" : "verification";

  const session = await getAgentSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  if (!core) {
    return (
      <AgentMain>
        <BackToToday />
        <DatabaseNotConfigured />
      </AgentMain>
    );
  }

  /* --- collect & deliver: the guided pickup run ------------------------- */
  if (kind === "pickup") {
    const pickup = await getPickupContext(core.db, session, taskId).catch(() => null);
    if (!pickup) notFound();

    const pickupAvatarUrl = await signAvatarUrl(
      pickup.customer?.avatarStoragePath ?? null,
    );
    const pickupState = await getBookingActionability(
      core.db,
      pickup.booking,
      new Date(),
    );

    const pickupView: PickupView = {
      taskId: pickup.task.id,
      paxName: pickup.booking.paxName,
      bookingRef: pickup.booking.ref,
      bookingStatus: pickup.booking.status,
      departureAirport: pickup.booking.departureAirport,
      truckName: pickup.shift?.truckName ?? null,
      travelStarted: pickup.task.startedAt !== null,
      bags: pickup.bags.map((bag) => ({
        id: bag.id,
        ordinal: bag.ordinal,
        sealId: bag.sealId,
        scanned: pickup.scannedBagIds.includes(bag.id),
      })),
      done: pickup.task.status === "done",
      exception: pickup.booking.status === "exception" || pickup.task.status === "failed",
    };

    return (
      <AgentMain>
        {/* The customer can accept the agreement while the driver is at the
            door. Without this the gate opens only on a manual reload. */}
        <LiveTasks
          enabled={!pickupView.done}
          stage={pickup.shift ? "pickup:mine" : "pickup:unclaimed"}
        />
        <BackToToday />
        <h1 className="font-display text-2xl font-semibold text-navy-800">
          Collect &amp; deliver
        </h1>
        {/* The same doorstep card as the verification visit — address, phone,
            flight — because a driver arriving for the pickup needs exactly the
            information a driver arriving for the visit needed. */}
        <ActionabilityNotice state={pickupState} />
        <DoorstepCard context={pickup} customerAvatarUrl={pickupAvatarUrl} />
        <PickupFlow view={pickupView} />
      </AgentMain>
    );
  }

  /* --- verification: the guided visit ---------------------------------- */
  const context = await getVisitContext(core.db, session, taskId).catch(() => null);
  if (!context) notFound();

  const { task, booking, bags, timeline } = context;
  const { identityGate: gate } = context;
  const visitState = await getBookingActionability(core.db, booking, new Date());

  // Signed here rather than in the client component: the URL is a bearer
  // credential for a photo of somebody's passport and must not outlive the
  // render. Minted as the signed-in agent over the anon key — the bucket's
  // storage policy (0022) is what permits it, and only for active staff.
  const passportPhotoUrl = gate.passport?.photoStoragePath
    ? await signPassportPhotoUrl(gate.passport.photoStoragePath)
    : null;

  // Same mechanism, far lower stakes: an avatar is not evidence, so it gets
  // the long TTL. Readable here because an agent is active staff.
  const customerAvatarUrl = await signAvatarUrl(
    context.customer?.avatarStoragePath ?? null,
  );

  const view: VisitView = {
    taskId: task.id,
    paxName: booking.paxName,
    bookingStatus: booking.status,
    arrived: timeline.some((e) => e.eventType === VISIT_EVENT_TYPES.arrived),
    identityPassed: gate.passed,
    agreement: {
      accepted: gate.agreement.accepted,
      version:
        gate.agreement.acceptedVersion?.version ??
        gate.agreement.currentVersion?.version ??
        null,
      acceptedAtLabel: gate.agreement.acceptance
        ? formatInstantInAirportTz(gate.agreement.acceptance.acceptedAt, context.tz)
        : null,
    },
    passport: {
      status: gate.passport?.status ?? "pending",
      photoUrl: passportPhotoUrl,
    },
    bags: bags.map((bag) => ({
      id: bag.id,
      ordinal: bag.ordinal,
      sealId: bag.sealId,
      weightKg: bag.weightKg,
      photoCount: bag.photoUrls.length,
    })),
    done: task.status === "done",
    exception: booking.status === "exception" || task.status === "failed",
  };

  const paymentCleared =
    context.paymentStatus === "authorized" || context.paymentStatus === "captured";

  return (
    <AgentMain>
      <LiveTasks enabled={!view.done} stage={gate.passed ? "gate:open" : "gate:blocked"} />
      <BackToToday />

      <h1 className="sr-only">
        Verify and seal for {booking.paxName}, booking {booking.ref}
      </h1>

      <ActionabilityNotice state={visitState} />

      <DoorstepCard context={context} customerAvatarUrl={customerAvatarUrl} />

      {/* A payment that has not cleared is a reason to stop before touching
          anyone's luggage, so it is a banner rather than a chip inside a
          heading — which is where it used to live. */}
      {!paymentCleared && (
        <Card className="flex items-start gap-3 border-warning/50 bg-warning/5 p-4">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-warning-foreground"
          />
          <p className="text-sm">
            <span className="font-medium">Payment has not cleared.</span> Check with ops
            before collecting these bags.
          </p>
        </Card>
      )}
      {paymentCleared && (
        /* A div, not a p: `Badge` renders a `<div>`, and a div inside a p is
           invalid HTML — the browser closes the paragraph early and React
           throws a hydration mismatch on the whole subtree. */
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Badge variant="success">Paid</Badge>
          This booking is paid for.
        </div>
      )}

      <VisitFlow view={view} />
    </AgentMain>
  );
}
