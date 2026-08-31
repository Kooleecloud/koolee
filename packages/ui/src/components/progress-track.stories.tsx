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
  "At the bag drop",
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
