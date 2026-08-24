import type { Meta, StoryObj } from "@storybook/react-vite";

import { VerifiedIndicator } from "./verified-indicator";

const meta = {
  title: "Primitives/VerifiedIndicator",
  component: VerifiedIndicator,
} satisfies Meta<typeof VerifiedIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BothStates: Story = {
  // Required props are satisfied for the type; `render` ignores them and
  // shows both states side by side instead.
  args: { subject: "Phone", verified: true },
  render: () => (
    <dl className="flex w-72 flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="flex items-center gap-2">
          +1 332 260 2829
          <VerifiedIndicator subject="Phone" verified />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="flex items-center gap-2">
          you@example.com
          <VerifiedIndicator subject="Email" verified={false} />
        </dd>
      </div>
    </dl>
  ),
};
