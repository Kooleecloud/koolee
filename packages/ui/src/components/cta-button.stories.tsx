import type { Meta, StoryObj } from "@storybook/react-vite";

import { CTAButton } from "./cta-button";

const meta = {
  title: "Primitives/CTAButton",
  component: CTAButton,
} satisfies Meta<typeof CTAButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tag: Story = {
  args: { children: "Book a pickup" },
};

export const Loading: Story = {
  args: { loading: true, children: "Booking…" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "How it works" },
};

/** Use on navy grounds where ghost borders vanish. */
export const GhostInverse: Story = {
  args: { variant: "ghost-inverse", children: "See how it works" },
  globals: { backgrounds: { value: "navy" } },
};
