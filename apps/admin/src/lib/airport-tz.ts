/**
 * The ops console's default day boundary — NOT a render zone.
 *
 * Every time the console DISPLAYS is rendered in its own booking's zone,
 * carried per row (`BoardRow.tz`, resolved from `airports.tz`). The board
 * shows bookings from every airport at once, so there is no single zone that
 * could correctly label all of them, and a console-wide constant would
 * silently mislabel every row from a non-Eastern airport the day one is added.
 *
 * What still needs ONE zone is a day-bounded QUERY: "windows starting today"
 * has to become a single `[start, end)` instant range, and a range needs one
 * boundary. When the operator has narrowed the board to a single airport we
 * use that airport's zone; otherwise we fall back to this. It must be stated
 * explicitly and never fall back to the server's — production runs in UTC, and
 * a "today" bucket that starts at 8 PM the previous evening would mis-plan the
 * whole shift.
 */
export const OPS_CONSOLE_TZ = "America/New_York";
