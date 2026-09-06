/**
 * How long ago a driver's phone last said anything, in words.
 *
 * FOR ONE PURPOSE: labelling a pin that is drawn but is not current. A grey
 * van on the map raises exactly one question — how old is this? — and an
 * absolute clock time ("11:42") makes the reader do the subtraction. "4 min
 * ago" is the answer to the question they actually have.
 *
 * COMPUTED ON THE SERVER, like every other time on this page. The trip page is
 * `force-dynamic` and re-renders every few seconds while anything is moving,
 * so the label is never more than one refresh out of date — and a client-side
 * ticking clock would be a second source of truth for a fact the server
 * already knows, on a page whose whole design is that the server owns the
 * facts. The tradeoff is real and small: on a page that has stopped
 * refreshing, this label ages. That only happens once nothing is moving, and
 * then the panel is gone anyway.
 *
 * DELIBERATELY COARSE. Nobody watching a van needs seconds, and "just now"
 * covers the window where a number would flicker between renders for no
 * reason.
 */
export function positionAgoLabel(recordedAt: Date | null, now: Date): string | null {
  if (!recordedAt) return null;

  const seconds = Math.round((now.getTime() - recordedAt.getTime()) / 1000);
  /*
   * A fix stamped in the future is a device clock that is wrong, not a
   * position from the future. "Just now" is the honest reading of it and the
   * only one that does not print a negative.
   */
  if (seconds < 90) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
