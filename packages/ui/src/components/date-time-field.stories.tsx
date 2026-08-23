import type { Meta, StoryObj } from "@storybook/react-vite";

import { DateTimeField } from "./date-time-field";

const meta = {
  title: "Forms/DateTimeField",
  component: DateTimeField,
} satisfies Meta<typeof DateTimeField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    name: "departureAt",
    hint: "Times are JFK local",
  },
};

export const Prefilled: Story = {
  args: {
    name: "departureAt",
    // Arbitrary minutes on purpose: a scheduled departure is 6:47 PM, not a
    // tidy quarter hour, so the time control must accept any minute.
    defaultValue: "2026-09-12T18:47",
    hint: "Times are JFK local",
  },
};

export const Flagged: Story = {
  name: "Flagged (extracted from a ticket)",
  args: {
    name: "departureAt",
    defaultValue: "2026-09-12T18:47",
    hint: "Times are JFK local",
    triggerClassName: "border-sky-400 ring-1 ring-sky-300",
  },
};
