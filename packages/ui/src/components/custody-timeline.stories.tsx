import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";
import { CustodyTimeline, type CustodyTimelineItem } from "./custody-timeline";

/**
 * The timeline had no story until a rendering bug hid behind that: the stage
 * dots were `display:inline`, so `size-3` did nothing and every VERTICAL
 * timeline in the product drew its rail with no dots on it. It looked correct
 * in the horizontal marketing variant, which is the only place anyone was
 * looking. Both orientations and all three states are pinned here now.
 */
const meta = {
  title: "Patterns/CustodyTimeline",
  component: CustodyTimeline,
} satisfies Meta<typeof CustodyTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

const ITEMS: CustodyTimelineItem[] = [
  {
    id: "booked",
    title: "Booking created",
    meta: "Tue 10 Jun, 9:12 AM EDT",
    state: "complete",
  },
  {
    id: "assigned",
    title: "Agent assigned",
    badge: <Badge variant="outline">ops</Badge>,
    meta: "Tue 10 Jun, 4:40 PM EDT",
    state: "complete",
  },
  {
    id: "sealed",
    title: "ID verified, bags sealed",
    badge: <Badge variant="outline">agent</Badge>,
    meta: "Wed 11 Jun, 7:05 AM EDT",
    state: "current",
  },
  {
    id: "bagdrop",
    title: "Delivered to your airline's bag drop",
    meta: "Expected Wed 11 Jun",
    state: "upcoming",
  },
];

/** The customer trip page and the ops custody trail. */
export const Vertical: Story = {
  args: { items: ITEMS },
};

/**
 * The state vocabulary on its own: navy for banked hand-offs, pulsing seal
 * orange for the one happening now, hollow for what is still ahead.
 */
export const States: Story = {
  args: {
    items: [
      { id: "c", title: "Complete", meta: "navy dot", state: "complete" },
      { id: "n", title: "Current", meta: "orange, pulsing", state: "current" },
      { id: "u", title: "Upcoming", meta: "hollow dot, dashed rail", state: "upcoming" },
    ],
  },
};

/** The marketing custody section. Connectors only appear at `lg`. */
export const Horizontal: Story = {
  args: {
    orientation: "horizontal",
    items: ITEMS.map((item) => ({
      ...item,
      description: "One line of marketing copy about this hand-off.",
    })),
  },
};

/** Nothing has happened yet — vertical only. */
export const Empty: Story = {
  args: { items: [] },
};
