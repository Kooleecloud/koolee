import { View } from "react-native";
import { MapPin, Navigation, Phone } from "lucide-react-native";
import type { BookingRow, PickupAddress } from "@koolee/api-contract";

import { Avatar, BookingRef, Button, Card, Text, useToast } from "@/components/ui";
import { callPhone, doorContact, formatE164ForDisplay, openMaps } from "@/lib/format";
import { formatHourRange, formatInstant, iso } from "@/lib/time";

/**
 * The fields the doorstep header reads. Both `VisitDetail` and
 * `PickupDetail` satisfy it — the same person drives to the same door for
 * both halves of the job, so the header is one component rather than two
 * that drift.
 */
export interface DoorstepContext {
  booking: Pick<
    BookingRow,
    | "paxName"
    | "ref"
    | "bagCount"
    | "flightNumber"
    | "departureAirport"
    | "departureAt"
    | "contactPhone"
  >;
  task: { scheduledStart: string | null; scheduledEnd: string | null };
  address: PickupAddress | null;
  customer: { fullName: string | null; phone: string | null } | null;
  /** Signed as this driver — staff read any folder under 0027's policy. */
  customerAvatarUrl: string | null;
  /**
   * How far the door is from this driver's last GPS ping, preformatted by
   * the server — "3.2 miles away · about 15 min". Null when either end has
   * no position, which is ordinary and says nothing is wrong.
   */
  travel: { label: string } | null;
  tz: string;
}

/**
 * The doorstep header: the window, the person, the door, and the two ways
 * to act on it. Address and phone are the first things on the screen, each
 * one tap from acting on it.
 */
export function DoorstepCard({
  context,
  actionable,
  testID = "doorstep-card",
}: {
  context: DoorstepContext;
  /**
   * Whether this job is still a job. False for a cancelled or completed
   * booking, and then NAVIGATE AND CALL ARE NOT DRAWN — both are offers to
   * do the work, and the only thing an affordance can produce on a stopped
   * job is a wasted drive or a confusing phone call to somebody who already
   * cancelled. The address itself stays: reading it is not acting on it.
   */
  actionable: boolean;
  testID?: string;
}) {
  const { booking, task, address, customer, customerAvatarUrl, travel, tz } = context;
  const toast = useToast();
  // The booking's own contact when the customer typed one for this pickup,
  // otherwise their verified account number.
  const contact = doorContact(booking, customer);

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

  // Google's `api=1` search URL: the one form Android opens in Maps and iOS
  // opens in Google Maps if installed, Safari otherwise. The place id keeps
  // a free-text query from landing at the wrong end of a long street.
  const mapsHref = addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}${
        address?.placeId ? `&query_place_id=${encodeURIComponent(address.placeId)}` : ""
      }`
    : null;

  const window = task.scheduledStart
    ? task.scheduledEnd
      ? formatHourRange(iso(task.scheduledStart), iso(task.scheduledEnd), tz)
      : formatInstant(iso(task.scheduledStart), tz)
    : "Unscheduled";

  return (
    <Card testID={testID} className="gap-3 p-4">
      {/* The ref leads, beside the window — the same treatment the job card
          gives it, so the number looks like the same thing on both screens
          either side of tapping into a stop. */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          {/* Window first, name second: the driver already knows roughly
              who, and is checking whether they are on time. */}
          <Text face="display" weight="semibold" className="text-2xl text-navy-800">
            {window}
          </Text>
          <View className="flex-row items-center gap-2">
            <Avatar
              size="sm"
              name={customer?.fullName ?? booking.paxName}
              src={customerAvatarUrl}
            />
            <Text weight="medium" className="flex-1 text-base text-foreground">
              {booking.paxName}
            </Text>
          </View>
        </View>
        <BookingRef value={booking.ref} testID={`${testID}-ref`} />
      </View>

      {addressLine ? (
        <View className="flex-row items-start gap-2">
          <View className="mt-0.5">
            <MapPin size={16} color="#58687e" />
          </View>
          <View className="flex-1">
            <Text className="text-sm text-muted-foreground">{addressLine}</Text>
            {travel ? (
              <Text className="text-sm text-navy-700">{travel.label}</Text>
            ) : null}
          </View>
        </View>
      ) : (
        <Text className="text-sm text-warning-foreground">
          No address on file — call ops before going anywhere.
        </Text>
      )}

      {actionable ? (
        <>
          <View className="flex-row gap-2">
            {mapsHref ? (
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                testID={`${testID}-navigate`}
                icon={<Navigation size={16} color="#0b2545" />}
                onPress={() => {
                  void openMaps(mapsHref).then((opened) => {
                    if (!opened) toast.error("Nothing on this phone can open a map.");
                  });
                }}
              >
                Navigate
              </Button>
            ) : null}
            {contact ? (
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                testID={`${testID}-call`}
                icon={<Phone size={16} color="#0b2545" />}
                onPress={() => {
                  void callPhone(contact.phone).then((opened) => {
                    if (!opened) toast.error("Nothing on this phone can place a call.");
                  });
                }}
              >
                Call
              </Button>
            ) : (
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                testID={`${testID}-call`}
                icon={<Phone size={16} color="#0b2545" />}
                disabled
              >
                No number
              </Button>
            )}
          </View>
          {contact ? (
            // Visible, not only behind the button — a driver on a bad
            // connection reads it out, and a call that does not connect from
            // the app has to be dialable from the phone's own keypad.
            <Text className="text-sm text-muted-foreground">
              {formatE164ForDisplay(contact.phone)}
            </Text>
          ) : null}
        </>
      ) : null}

      <View className="border-t border-border pt-3">
        <Text className="text-xs text-muted-foreground">
          {booking.bagCount} bag{booking.bagCount === 1 ? "" : "s"} ·{" "}
          {booking.flightNumber} · {booking.departureAirport} · departs{" "}
          {formatInstant(iso(booking.departureAt), tz)}
        </Text>
      </View>
    </Card>
  );
}
