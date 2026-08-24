import type { Meta, StoryObj } from "@storybook/react-vite";

import { CoverageScene } from "./coverage-scene";

/**
 * The coverage diagram that replaced a dashed "map coming soon" box. It is a
 * schematic and the caption has to keep saying so — the arcs are drawn, not
 * geographic.
 */
const meta = {
  title: "Marketing/CoverageScene",
  component: CoverageScene,
} satisfies Meta<typeof CoverageScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    airports: ["LGA", "JFK", "EWR"],
    caption:
      "Schematic, not to scale. Pickups across all five boroughs and Hudson County, NJ — your ZIP confirms instantly at booking.",
  },
};

/** Narrow column: the codes stay legible, the caption carries the reading. */
export const Narrow: Story = {
  args: { airports: ["LGA", "JFK", "EWR"] },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
};
