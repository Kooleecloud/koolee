import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrDivider } from "./or-divider";

const meta = {
  title: "Primitives/OrDivider",
  component: OrDivider,
} satisfies Meta<typeof OrDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Between the flight form and the e-ticket upload: two ways in, not two steps. */
export const Default: Story = {};

export const CustomLabel: Story = {
  args: { children: "or, faster" },
};
