import type { Meta, StoryObj } from "@storybook/react-vite";

import { HeroRouteScene } from "./hero-route-scene";

/**
 * The hero scene. Story order is the product order and that is the whole
 * point: every beat at the door banks BEFORE the van moves. Watch the loop —
 * if "Sealed" ever lights while the van is on the road, the story is wrong
 * again (the previous version drew four waypoints along the route and read
 * exactly that way).
 *
 * Also worth checking here: shrink the panel. The beat labels are HTML, not
 * SVG `<text>`, so they must stay readable at phone width.
 */
const meta = {
  title: "Marketing/HeroRouteScene",
  component: HeroRouteScene,
} satisfies Meta<typeof HeroRouteScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Hero column width on a large screen. */
export const HeroColumn: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

/** Phone width — the beat rail wraps and the labels stay legible. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-[327px]">
        <Story />
      </div>
    ),
  ],
};
