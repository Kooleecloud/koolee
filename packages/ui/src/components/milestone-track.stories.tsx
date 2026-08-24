import type { Meta, StoryObj } from "@storybook/react-vite";

import { MilestoneTrack } from "./milestone-track";

const meta = {
  title: "Marketing/MilestoneTrack",
  component: MilestoneTrack,
} satisfies Meta<typeof MilestoneTrack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A founder's trajectory, ending on Koolee — the last stop is the emphasis. */
export const Founder: Story = {
  args: {
    label: "Track record",
    items: [
      "Fonterra · logistics",
      "Indiana University · BI",
      "Collegiate esports",
      "Campus airport shuttle",
      "Koolee",
    ],
  },
};

export const Short: Story = {
  args: { items: ["Stevens Institute · MS CS", "Koolee"] },
};

/** Renders nothing rather than an empty rule. */
export const Empty: Story = {
  args: { items: [] },
};
