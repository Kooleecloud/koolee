import type { Meta, StoryObj } from "@storybook/react-vite";

import { TripContrast } from "./trip-contrast";

/**
 * The homepage's "what changes" band. Pinned here because the whole point is
 * the asymmetry between the two columns — a well-meant tidy-up that gives both
 * sides the same card treatment deletes the argument the component exists to
 * make.
 */
const meta = {
  title: "Marketing/TripContrast",
  component: TripContrast,
} satisfies Meta<typeof TripContrast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    before: {
      label: "Getting to the airport today",
      items: [
        "Wrestle every bag down the stairs and into a car.",
        "Pay for the bigger car, because the bags will not fit in the small one.",
        "Queue at the bag drop with all of it in tow.",
        "Reach security already worn out.",
      ],
    },
    after: {
      label: "Getting to the airport with Koolee",
      items: [
        "Open the door. Your agent takes it from there.",
        "Travel to the airport however you like.",
        "Walk past the bag-drop line.",
        "Reach security carrying your boarding pass.",
      ],
    },
  },
};

/** Uneven lists still align to the top of each column. */
export const Uneven: Story = {
  args: {
    before: { label: "Today", items: ["One thing.", "Another thing.", "A third."] },
    after: { label: "With Koolee", items: ["Answer the door."] },
  },
};
