import type { Meta, StoryObj } from "@storybook/react-vite";

import { NumberStepper } from "./number-stepper";

const meta = {
  title: "Forms/NumberStepper",
  component: NumberStepper,
} satisfies Meta<typeof NumberStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "bagCount", unit: "bags", defaultValue: 1, min: 1, max: 10 },
};

export const AtMaximum: Story = {
  args: { name: "bagCount", unit: "bags", defaultValue: 10, min: 1, max: 10 },
};

export const Disabled: Story = {
  args: { name: "bagCount", unit: "bags", defaultValue: 2, disabled: true },
};
