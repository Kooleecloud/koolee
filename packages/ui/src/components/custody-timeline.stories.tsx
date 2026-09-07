import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./avatar";
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

/**
 * NAMED ACTORS AND PHOTO BUTTONS — the trip page's rendering.
 *
 * Two changes that only make sense together, which is why they share a story.
 *
 * The AVATAR AND NAME turn "Agent assigned" — a stranger is coming to your
 * door — into "Agent assigned · Ravi", with a face the customer can check
 * against the person who knocks. Only the field roles get this; an admin who
 * reassigns a pickup is an actor on the real trail and is deliberately never
 * named to the customer.
 *
 * The PHOTO BUTTON replaces a 192px thumbnail per event. A completed booking
 * carries twenty-odd events, so the trail was a screen and a half of
 * suitcase crops between the reader and the next fact — and every crop was
 * unreadable anyway, since the detail that makes a proof photo proof is the
 * seal number and that needs the dialog. The evidence did not change; the
 * amount of page it occupies before somebody asks for it did.
 *
 * What to check by hand: the button opens the SAME dialog the thumbnail did,
 * and reaches it by keyboard.
 */
export const NamedActorsWithPhotoButtons: Story = {
  args: {
    items: [
      {
        id: "assigned",
        title: "Agent assigned",
        badge: <Badge variant="outline">ops</Badge>,
        meta: "Tue 10 Jun, 4:40 PM EDT",
        actor: {
          name: "Ravi",
          avatar: <Avatar size="sm" name="Ravi" alt="" />,
        },
        state: "complete",
      },
      {
        id: "sealed",
        title: "Bag sealed and photographed",
        badge: <Badge variant="outline">agent</Badge>,
        meta: "Wed 11 Jun, 7:05 AM EDT",
        photoUrl:
          "data:image/svg+xml;utf8," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#0f2740"/><text x="240" y="190" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">seal 4471-A</text></svg>`,
          ),
        photoAlt: "Sealed bag",
        photoAsButton: true,
        state: "complete",
      },
      {
        id: "chosen",
        title: "You chose your driver",
        badge: <Badge variant="outline">customer</Badge>,
        meta: "Wed 11 Jun, 7:20 AM EDT",
        actor: {
          name: "Yara",
          avatar: <Avatar size="sm" name="Yara" alt="" />,
        },
        state: "current",
      },
    ],
  },
};
