import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigation, Phone } from "lucide-react-native";
import { apiRoutes, type TaskBookingContext } from "@koolee/api-contract";

import { Button, useToast } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { callPhone, doorContact, formatE164ForDisplay, openMaps } from "@/lib/format";
import { addressText, mapsUrl } from "@/lib/job";
import { keys } from "@/lib/queries";
import { runStep } from "@/offline/actions";

/**
 * Navigate and Call — the two things a driver does with a job that are not
 * inside the app.
 *
 * Both are the reason the driver is holding the phone: one gets them to the
 * door, the other gets them through it. Typing an address into Maps from
 * memory, at the wheel, is the failure this replaces. Full-width and side by
 * side so either is a thumb-sized target, and both open out of the app rather
 * than into a screen the driver then has to leave.
 *
 * Navigate does double duty on a startable pickup — see `NavigateAction`.
 */

/** The address and contact fields, so a contract row or a `JobBooking` both fit. */
export type ActionBooking = Pick<
  TaskBookingContext,
  | "ref"
  | "contactPhone"
  | "customerPhone"
  | "addressLine1"
  | "addressCity"
  | "addressState"
  | "addressZip"
  | "addressPlaceId"
>;

export type JobActionsSize = "default" | "lg";

const ICON = { default: 16, lg: 18 } as const;
const FOREGROUND = "#152337";

export interface JobActionsProps {
  booking: ActionBooking;
  /** `lg` on the visit screen, where these are the primary controls. */
  size?: JobActionsSize;
  /**
   * The pickup task this stop would start, or null. Passed down rather than
   * derived here: only the caller knows which phase is next.
   */
  startsPickupTaskId?: string | null;
}

export function JobActions({
  booking,
  size = "default",
  startsPickupTaskId = null,
}: JobActionsProps) {
  const toast = useToast();
  // Resolved, not read raw: `contactPhone` is only ever set for email-only
  // customers, which is why most jobs used to show a disabled "No number"
  // while the customer's verified number sat on their account.
  const contact = doorContact(booking, { phone: booking.customerPhone });
  const phone = contact?.phone ?? null;

  return (
    <View className="flex-row gap-2">
      <NavigateAction
        url={mapsUrl(booking)}
        address={addressText(booking)}
        startsPickupTaskId={startsPickupTaskId}
        size={size}
        testID={`job-navigate-${booking.ref}`}
      />
      {phone ? (
        <Button
          variant="outline"
          size={size}
          className="flex-1"
          icon={<Phone size={ICON[size]} color={FOREGROUND} />}
          accessibilityHint={formatE164ForDisplay(phone)}
          testID={`job-call-${booking.ref}`}
          onPress={() => {
            void callPhone(phone).then((opened) => {
              if (!opened) toast.error("Couldn't open the dialler.");
            });
          }}
        >
          Call
        </Button>
      ) : (
        /* Not hidden: a driver needs to know the absence is the record's, not
           a loading state, before they start looking for another way in. */
        <Button
          variant="outline"
          size={size}
          className="flex-1"
          icon={<Phone size={ICON[size]} color={FOREGROUND} />}
          accessibilityHint="No contact number on file"
          testID={`job-call-${booking.ref}`}
          disabled
        >
          No number
        </Button>
      )}
    </View>
  );
}

/**
 * Navigate — and, when this stop is a pickup leg that has not started yet, the
 * thing that starts it.
 *
 * THE ORDER MATTERS. The start is fired and deliberately NOT awaited before
 * the maps app opens. Awaiting it would put a server round-trip between the
 * driver's thumb and their map, on a phone, in a van, on whatever signal a
 * kerbside has. The bookkeeping is the thing that waits, never the driver.
 *
 * `runStep` is what makes that safe without a signal: the start is queued on
 * the phone and replayed when one comes back, and core's `startPickupTravel`
 * is idempotent, so the double-fire this permits (tap Navigate, then tap "Set
 * off" in the guided flow) is a no-op the second time.
 */
function NavigateAction({
  url,
  address,
  startsPickupTaskId,
  size,
  testID,
}: {
  url: string;
  address: string;
  startsPickupTaskId: string | null;
  size: JobActionsSize;
  testID: string;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (taskId: string) =>
      runStep({
        label: "Start & navigate",
        path: apiRoutes.pickup.start(taskId),
        body: {},
      }),
    onSuccess: (result) => {
      if (result.queued) {
        toast.info("No signal — the pickup will start when you're back online.");
        return;
      }
      // Worth saying out loud: this is the moment the customer's page starts
      // tracking, and the driver should know they are now visible.
      toast.success("Pickup started — your customer can see you on the way.");
      // The list, then everything else: the task detail's key belongs to its
      // own screen, and a bare invalidate reaches it without naming it.
      void qc.invalidateQueries({ queryKey: keys.tasks });
      void qc.invalidateQueries();
    },
    onError: (error) => {
      // Never blocks the map, so it cannot be an error screen. A driver who
      // sees this can still finish the leg from the job screen.
      toast.error(
        error instanceof ApiRequestError ? error.message : "Couldn't start the pickup.",
      );
    },
  });

  const onPress = () => {
    // `isPending` guards a double-tap firing two starts before the first
    // returns. Not a disabled state: the MAP must keep opening either way.
    if (startsPickupTaskId && !start.isPending) start.mutate(startsPickupTaskId);
    void openMaps(url).then((opened) => {
      if (!opened) toast.error("Couldn't open a maps app.");
    });
  };

  return (
    <Button
      variant="outline"
      size={size}
      className="flex-1"
      icon={<Navigation size={ICON[size]} color={FOREGROUND} />}
      accessibilityHint={address}
      testID={testID}
      onPress={onPress}
    >
      {startsPickupTaskId ? "Start & navigate" : "Navigate"}
    </Button>
  );
}
