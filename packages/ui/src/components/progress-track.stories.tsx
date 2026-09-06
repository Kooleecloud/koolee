import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProgressTrack } from "./progress-track";

/**
 * The customer's driver run, as it appears on the trip page. Same `StageDot`
 * as `CustodyTimeline`, so the two progressions on that page speak one visual
 * language — they used to speak two.
 */
const meta = {
  title: "App/ProgressTrack",
  component: ProgressTrack,
} satisfies Meta<typeof ProgressTrack>;

export default meta;
type Story = StoryObj<typeof meta>;

const PICKUP_STEPS = [
  "Driver booked",
  "On the way",
  "Bags collected",
  "In transit",
  "Delivered",
];

/** As the trip page builds it once a driver is chosen — see `pickupSteps`. */
const NAMED_STEPS = [
  "Ravi assigned",
  "On the way",
  "Bags collected",
  "In transit",
  "Delivered",
];

/** Mid-run: two stages banked, one pulsing, two still ahead. */
export const OnTheWay: Story = {
  args: { steps: PICKUP_STEPS, currentIndex: 1 },
};

/** The moment a driver is chosen and nothing has moved yet. */
export const JustBooked: Story = {
  args: { steps: PICKUP_STEPS, currentIndex: 0 },
};

/** Delivered — the last stage is the current one, not a fourth "done" state. */
export const AtTheBagDrop: Story = {
  args: { steps: PICKUP_STEPS, currentIndex: 4 },
};

/**
 * A cancelled or exception booking: the track is not the story, so nothing
 * claims to be in progress.
 */
export const NothingCurrent: Story = {
  args: { steps: PICKUP_STEPS, currentIndex: -1 },
};

/**
 * COMPACT — how the trip page renders it now, as a caption under the map.
 *
 * THE STORY TO OPEN ON A PHONE VIEWPORT. The default variant stacks into five
 * rows below `sm`, which was fine when the track was the card and pushed the
 * map off the screen once the map became it. This has to stay at roughly one
 * line at 375px wide.
 *
 * What to check by hand:
 *  - five labels fit without the dots drifting out of alignment;
 *  - a long first stage ("Konstantina assigned") WRAPS inside its own column
 *    rather than shoving the next dot sideways;
 *  - the connector rails are still there. A row of dots with no thread between
 *    them stops reading as a progression and starts reading as a legend.
 */
export const Compact: Story = {
  args: { steps: NAMED_STEPS, currentIndex: 1, compact: true },
};

/** The wrapping case, deliberately awkward. */
export const CompactLongName: Story = {
  args: {
    steps: ["Konstantina assigned", ...NAMED_STEPS.slice(1)],
    currentIndex: 2,
    compact: true,
  },
};

/** Cancelled, compact: every stage struck through, nothing current. */
export const CompactCancelled: Story = {
  args: { steps: NAMED_STEPS, currentIndex: -1, compact: true, cancelled: true },
};
