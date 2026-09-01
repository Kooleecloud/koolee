import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  BookingStatusBadge,
  Button,
  cn,
  DatabaseNotConfigured,
  EmptyState,
  LinkedTableRow,
  PageHeader,
  RowLink,
} from "@koolee/ui";
import {
  airportLocalDay,
  BOARD_SORT_KEYS,
  formatDayInAirportTz,
  formatHourRangeInAirportTz,
  formatTimeInAirportTz,
  getDisplayZones,
  listBookingsBoard,
  zoneFor,
  type BoardMatchKey,
  type BoardRow,
  type BoardSortKey,
  type BookingStatus,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { BoardFilters } from "./board-filters";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

/**
 * The two ways a booking is at risk, named rather than merged.
 *
 * Before the driver slice there was one flag and one word ("at risk"), and it
 * only ever meant "paid, nobody assigned to verify". A booking whose bags were
 * sealed on a doorstep with nobody coming for them was not flagged at all —
 * every at-risk surface read `verification_tasks` only. Distinct labels because
 * the fix is different: one needs an agent sent to a door, the other a van.
 */
const AT_RISK_LABEL = {
  no_agent: "needs an agent",
  no_driver: "needs a driver",
} as const;

/**
 * WHY THE ROW MATCHED, in the fewest words that still answer it.
 *
 * Search reads eleven fields; the board shows eight. Without this, a row can
 * appear for a reason that is nowhere on it — a seal id, an email address, a
 * phone number — and the only way to learn why is to open the booking.
 *
 * "Passenger" and "Customer" are separate because they genuinely differ:
 * somebody books for a parent, and the two names on the record are not the
 * same person.
 */
const MATCH_LABEL: Record<BoardMatchKey, string> = {
  ref: "Ref",
  id: "ID",
  seal: "Seal",
  phone: "Phone",
  passenger: "Passenger",
  customer: "Customer",
  email: "Email",
  flight: "Flight",
  driver: "Driver",
  truck: "Truck",
  agent: "Agent",
};

/** Past this the Ref column starts pushing the board sideways. */
const MAX_MATCH_BADGES = 3;

const STATUSES: BookingStatus[] = [
  "draft",
  "paid",
  "agent_assigned",
  "verified_sealed",
  "awaiting_pickup",
  "in_transit",
  "delivered_to_bagdrop",
  "completed",
  "exception",
  "cancelled",
];

const AIRPORTS = [
  { value: "JFK", label: "JFK", hint: "John F. Kennedy" },
  { value: "LGA", label: "LGA", hint: "LaGuardia" },
  { value: "EWR", label: "EWR", hint: "Newark Liberty" },
] as const;

type Airport = (typeof AIRPORTS)[number]["value"];

/**
 * A column header that sorts.
 *
 * A plain link, not a button: sort state lives in the URL alongside the
 * filters, so the board an operator is looking at stays one shareable
 * address. `aria-sort` is on the cell so screen readers announce the order
 * rather than leaving the arrow as decoration only sighted users get.
 */
function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  href,
  className,
}: {
  label: string;
  sortKey: BoardSortKey;
  activeKey: BoardSortKey;
  direction: "asc" | "desc";
  href: string;
  className?: string;
}) {
  const active = sortKey === activeKey;
  return (
    <th
      className={cn("px-4 py-2 font-medium whitespace-nowrap", className)}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={href}
        className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
      >
        {label}
        <span aria-hidden className={active ? "" : "text-muted-foreground/40"}>
          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );
}

/**
 * A board time cell: clock time on the first line, date on the second.
 *
 * Both lines matter and they are not equally urgent. An operator scanning the
 * board reads hours — "who is at 10 AM" — and needs the date only to place the
 * row on a calendar, so the time leads and the date sits under it in muted
 * text. Stacking also keeps three time columns readable side by side, which a
 * single "Tue 18 Aug, 10:00 AM EDT" line per column does not.
 *
 * The zone rides on the time line (see `formatTimeInAirportTz`) because it
 * qualifies the clock, not the day. Every value here is airport-local.
 */
function TimeCell({
  time,
  date,
  children,
}: {
  time: string;
  date: string;
  /** Badges — "today", "at risk" — pinned beside the time. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="flex items-center gap-2 whitespace-nowrap">
        {time}
        {children}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">{date}</span>
    </div>
  );
}

/** `?status=paid,exception` → the valid members of that list, deduped. */
function parseList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T[] {
  if (!raw) return [];
  const valid = new Set<string>(allowed);
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => valid.has(s)),
    ),
  ] as T[];
}

/**
 * The dispatch board: bookings by pickup window, filterable by status /
 * airport / day, with assignment visible and at-risk rows surfaced (paid,
 * unassigned, window within 12h — a derived flag, not a scheduling engine).
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    airport?: string;
    today?: string;
    q?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const statuses = parseList(params.status, STATUSES);
  const airports = parseList<Airport>(
    params.airport,
    AIRPORTS.map((a) => a.value),
  );
  const today = params.today === "1";
  const search = (params.q ?? "").trim();
  const sortKey = (BOARD_SORT_KEYS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as BoardSortKey)
    : "window";
  const sortDir = params.dir === "desc" ? "desc" : "asc";
  const now = new Date();

  const core = tryGetCore();
  let rows: BoardRow[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      // A day-bounded query needs ONE boundary (see OPS_CONSOLE_TZ). When the
      // operator has narrowed to a single airport, that airport's own zone is
      // the honest boundary; otherwise the console default stands in.
      const zones = await getDisplayZones(core.db);
      const filterTz =
        airports.length === 1 ? zoneFor(zones, airports[0]!) : OPS_CONSOLE_TZ;

      rows = await listBookingsBoard(
        core.db,
        {
          ...(statuses.length > 0 ? { statuses } : {}),
          ...(airports.length > 0 ? { airports } : {}),
          ...(today ? { day: { on: now, tz: filterTz } } : {}),
          ...(search ? { search } : {}),
          sort: { key: sortKey, direction: sortDir },
          limit: 200,
        },
        // Beyond the horizon a booking is unassigned by design, not at risk.
        { now, assignmentHorizonHours: core.defaults.assignmentHorizonHours },
      );
    } catch {
      unavailable = true;
    }
  }

  const atRiskCount = rows.filter((r) => r.atRisk).length;
  const noDriverCount = rows.filter((r) => r.atRiskReason === "no_driver").length;
  const filtered = statuses.length > 0 || airports.length > 0 || today || search !== "";

  /** Sort links keep every other filter — the URL stays the whole board state. */
  const sortHref = (key: BoardSortKey) => {
    const next = new URLSearchParams();
    if (statuses.length > 0) next.set("status", statuses.join(","));
    if (airports.length > 0) next.set("airport", airports.join(","));
    if (today) next.set("today", "1");
    if (search) next.set("q", search);
    next.set("sort", key);
    // Clicking the active column flips it; a new column starts ascending.
    if (key === sortKey && sortDir === "asc") next.set("dir", "desc");
    return `/bookings?${next.toString()}`;
  };

  return (
    <ConsoleMain width="wide">
      <PageHeader
        title="Bookings"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${rows.length} shown${atRiskCount > 0 ? ` · ${atRiskCount} at risk` : ""}${
                noDriverCount > 0 ? ` (${noDriverCount} with no driver)` : ""
              }`
        }
      />

      <BoardFilters
        statusOptions={STATUSES.map((s) => ({ value: s, label: s }))}
        airportOptions={AIRPORTS.map((a) => ({ ...a }))}
        statuses={statuses}
        airports={airports}
        today={today}
        search={search}
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No bookings"
          description={
            search
              ? `Nothing matches "${search}". Search reads the ref, seal ids, names, email, phone and flight number, plus the driver, truck and agent — any part of any of them.`
              : filtered
                ? "Nothing matches these filters."
                : "No bookings yet."
          }
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/bookings">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        /* The board scrolls inside its own region rather than with the page,
           which is what lets `thead` stay put: `overflow-x-auto` alone makes
           this element the scroll container for BOTH axes, so a sticky header
           inside it would have nothing to stick against. Ops reads a
           twenty-row board by column, and a header that scrolls away turns
           every glance into a re-count of table cells. */
        <div className="max-h-[calc(100dvh-15rem)] min-h-80 overflow-auto rounded-lg border bg-card">
          <table className="console-table w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left [&_th]:border-b [&_th]:border-border">
              <tr>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Ref</th>
                {/* Window before Booked, deliberately. It is the column the
                    board sorts by, and on a narrow viewport only the first
                    two columns and the pinned Status stay on screen — so
                    whichever sits here is what an operator sees on a phone.
                    "When is the pickup" beats "when did this come in". */}
                <SortableHeader
                  label="Pickup window"
                  sortKey="window"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("window")}
                />
                <SortableHeader
                  label="Booked"
                  sortKey="booked"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("booked")}
                />
                <SortableHeader
                  label="Departs"
                  sortKey="departure"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("departure")}
                />
                <th className="px-4 py-2 font-medium whitespace-nowrap">Flight</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Passenger</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Bags</th>
                <SortableHeader
                  label="Agent"
                  sortKey="agent"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("agent")}
                />
                {/* Not sortable, deliberately: a driver is chosen by the
                    customer minutes before the run, so ordering a whole board
                    by it would sort mostly-empty against mostly-empty. */}
                <th className="px-4 py-2 font-medium whitespace-nowrap">Driver</th>
                {/* Pinned. Nine columns of a dispatch board do not fit a
                    laptop, and the one that fell off the right edge was the
                    booking's state — the value an operator scans the board
                    FOR. `z-20` so the corner cell stays above both the sticky
                    header row and the sticky column. */}
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("status")}
                  className="sticky right-0 z-20 border-l border-border bg-muted shadow-[-6px_0_8px_-6px_rgba(11,37,69,0.12)]"
                />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(
                ({
                  booking,
                  slotStart,
                  assigneeEmail,
                  assigneeName,
                  atRisk,
                  atRiskReason,
                  driverName,
                  truckName,
                  matchedOn,
                  tz,
                }) => {
                  const windowEnd = booking.pickupWindowEnd;
                  // "Today" is evaluated in THIS booking's zone, which stays
                  // well-defined even when the board spans several — unlike a
                  // single console-wide "today", which has no meaning on a
                  // mixed-zone list.
                  const isToday =
                    slotStart !== null &&
                    airportLocalDay(slotStart, tz) === airportLocalDay(now, tz);
                  return (
                    <LinkedTableRow
                      key={booking.id}
                      className={atRisk ? "bg-warning/10" : "hover:bg-accent/5"}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">
                        <RowLink
                          href={`/bookings/${booking.id}`}
                          linkComponent={Link}
                          className="font-mono text-xs"
                        >
                          {booking.ref}
                        </RowLink>
                        {/* Under the ref rather than in a column of its own:
                            it exists only while a search is running, and a
                            column that appears and disappears would move every
                            other one sideways as an operator types.

                            ONE LINE, NEVER WRAPPED. Wrapping made a row with
                            two badges twice the height of its neighbours, and
                            a board whose rows are different heights is
                            measurably harder to scan down. Three then "+N"
                            because a lazy term ("1") can hit five fields at
                            once — the count keeps the column still, and the
                            tooltip still names them. */}
                        {matchedOn.length > 0 ? (
                          <span className="mt-1 flex gap-1 whitespace-nowrap">
                            {matchedOn.slice(0, MAX_MATCH_BADGES).map((key) => (
                              <Badge key={key} variant="outline" className="text-[10px]">
                                {MATCH_LABEL[key]}
                              </Badge>
                            ))}
                            {matchedOn.length > MAX_MATCH_BADGES ? (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                                title={matchedOn
                                  .slice(MAX_MATCH_BADGES)
                                  .map((key) => MATCH_LABEL[key])
                                  .join(", ")}
                              >
                                +{matchedOn.length - MAX_MATCH_BADGES}
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        {slotStart ? (
                          <TimeCell
                            time={
                              windowEnd
                                ? formatHourRangeInAirportTz(slotStart, windowEnd, tz)
                                : /* Legacy slot rows carry a start with no end. */
                                  formatTimeInAirportTz(slotStart, tz)
                            }
                            date={formatDayInAirportTz(slotStart, tz)}
                          >
                            {isToday && <Badge variant="outline">today</Badge>}
                            {atRisk && (
                              <Badge variant="warning">
                                {AT_RISK_LABEL[atRiskReason!]}
                              </Badge>
                            )}
                          </TimeCell>
                        ) : (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            —
                            {atRisk && (
                              <Badge variant="warning">
                                {AT_RISK_LABEL[atRiskReason!]}
                              </Badge>
                            )}
                          </span>
                        )}
                      </td>
                      {/* When the booking came in — not when it happens. An
                        operator triaging a board needs to tell a booking made
                        an hour ago from one made last week. */}
                      <td className="px-4 py-2">
                        <TimeCell
                          time={formatTimeInAirportTz(booking.createdAt, tz)}
                          date={formatDayInAirportTz(booking.createdAt, tz)}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <TimeCell
                          time={formatTimeInAirportTz(booking.departureAt, tz)}
                          date={formatDayInAirportTz(booking.departureAt, tz)}
                        />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-medium">{booking.flightNumber}</span>
                        <span className="ml-2 text-muted-foreground">
                          {booking.departureAirport}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{booking.paxName}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{booking.bagCount}</td>
                      {/* Name first: ops talk about "Leo", not about
                        agent@koolee.local. The email stays because it is the
                        unambiguous identifier when two agents share a first
                        name, and it is what the assignment panel lists. */}
                      <td className="px-4 py-2">
                        {assigneeEmail ? (
                          <div className="flex flex-col leading-tight">
                            <span className="whitespace-nowrap">
                              {assigneeName ?? assigneeEmail}
                            </span>
                            {assigneeName && (
                              <span className="text-xs whitespace-nowrap text-muted-foreground">
                                {assigneeEmail}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {driverName || truckName ? (
                          <div className="flex flex-col leading-tight">
                            <span className="whitespace-nowrap">
                              {driverName ?? "Driver"}
                            </span>
                            {truckName && (
                              <span className="text-xs whitespace-nowrap text-muted-foreground">
                                {truckName}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {atRiskReason === "no_driver" ? "none yet" : "—"}
                          </span>
                        )}
                      </td>
                      {/* Opaque on purpose: a translucent pinned cell shows the
                        columns scrolling underneath it. The at-risk tint stays
                        on the rest of the row, and the at-risk badge rides
                        the pickup-window cell, so no signal is lost. */}
                      <td className="sticky right-0 z-10 border-l border-border bg-card shadow-[-6px_0_8px_-6px_rgba(11,37,69,0.12)] px-4 py-2 whitespace-nowrap">
                        <BookingStatusBadge status={booking.status} />
                      </td>
                    </LinkedTableRow>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
    </ConsoleMain>
  );
}
