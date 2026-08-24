import type { Meta, StoryObj } from "@storybook/react-vite";

import { JourneyGlyph } from "./journey-glyph";
import { StepCard } from "./step-card";

/**
 * Both shapes of the card. The bare variant (no `body`) is the one the
 * homepage ships: the copy review cut the explanatory paragraphs, so the
 * glyph grows and the title moves to the bottom of the card. Pinned so a
 * later "the body prop is required, surely" refactor has to argue with this.
 */
const meta = {
  title: "Marketing/StepCard",
  component: StepCard,
} satisfies Meta<typeof StepCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {
  args: {
    step: 2,
    title: "Agent arrives, verifies your details, weighs and seals your bags",
    visual: <JourneyGlyph name="seal" />,
  },
};

export const WithBody: Story = {
  args: {
    step: 3,
    title: "Live tracking",
    body: "Follow your bags from your doorstep to the terminal.",
    visual: <JourneyGlyph name="track" />,
  },
};

/** The four as they appear on the homepage grid. */
export const Row: Story = {
  args: { step: 1, title: "Book a Koolee online" },
  render: () => (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <StepCard step={1} title="Book a Koolee online" visual={<JourneyGlyph name="book" />} />
      <StepCard
        step={2}
        title="Agent arrives, verifies your details, weighs and seals your bags"
        visual={<JourneyGlyph name="seal" />}
      />
      <StepCard step={3} title="Live tracking" visual={<JourneyGlyph name="track" />} />
      <StepCard
        step={4}
        title="Delivered to your airline"
        visual={<JourneyGlyph name="deliver" />}
      />
    </div>
  ),
};
