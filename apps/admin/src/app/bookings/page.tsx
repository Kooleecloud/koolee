import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  BookingStatusBadge,
  Button,
  ContentColumn,
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
  type BoardRow,
  type BoardSortKey,
  type BookingStatus,
} from "@koolee/core";

import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { BoardFilters } from "./board-filters";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";


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
}: {
  label: string;
  sortKey: BoardSortKey;
  activeKey: BoardSortKey;
  direction: "asc" | "desc";
  href: string;
}) {
  const active = sortKey === activeKey;
  return (
    <th
      className="px-4 py-2 font-medium whitespace-nowrap"
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
function parseList<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const valid = new Set<string>(allowed);
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => valid.has(s)))] as T[];
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

      rows = await listBookingsBoard(core.db, {
        ...(statuses.length > 0 ? { statuses } : {}),
        ...(airports.length > 0 ? { airports } : {}),
        ...(today ? { day: { on: now, tz: filterTz } } : {}),
        ...(search ? { search } : {}),
        sort: { key: sortKey, direction: sortDir },
        limit: 200,
      });
    } catch {
      unavailable = true;
    }
  }

  const atRiskCount = rows.filter((r) => r.atRisk).length;
  const filtered =
    statuses.length > 0 || airports.length > 0 || today || search !== "";

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
    <ContentColumn width="full">
      <PageHeader
        title="Bookings"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${rows.length} shown${atRiskCount > 0 ? ` · ${atRiskCount} at risk` : ""}`
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
              ? `Nothing matches "${search}". Refs are the last six characters of the booking id; seals and phone numbers match on any part.`
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
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Ref</th>
                <SortableHeader
                  label="Booked"
                  sortKey="booked"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("booked")}
                />
                <SortableHeader
                  label="Pickup window"
                  sortKey="window"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("window")}
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
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  activeKey={sortKey}
                  direction={sortDir}
                  href={sortHref("status")}
                />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ booking, slotStart, assigneeEmail, assigneeName, atRisk, tz }) => {
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
                          {atRisk && <Badge variant="warning">at risk</Badge>}
                        </TimeCell>
                      ) : (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          —
                          {atRisk && <Badge variant="warning">at risk</Badge>}
                        </span>
                      )}
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
                    <td className="px-4 py-2 whitespace-nowrap">
                      <BookingStatusBadge status={booking.status} />
                    </td>
                  </LinkedTableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ContentColumn>
  );
}
