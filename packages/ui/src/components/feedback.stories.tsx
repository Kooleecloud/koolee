import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";
import { DatabaseNotConfigured, EmptyState } from "./empty-state";
import { FormMessage } from "./form-message";
import { PageSkeleton, Skeleton } from "./skeleton";
import { Spinner } from "./spinner";

const meta = {
  title: "Feedback",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FormMessages: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <FormMessage variant="error">
        We could not verify that code. Check the six digits and try again.
      </FormMessage>
      <FormMessage variant="success">Profile saved.</FormMessage>
      <FormMessage variant="info">
        Prefilled from your ticket — double-check the flight number.
      </FormMessage>
    </div>
  ),
};

export const EmptyStates: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <EmptyState
        title="No trips yet"
        description="Book a pickup and your live chain-of-custody timeline will appear here."
        action={<Button>Book a pickup</Button>}
      />
      <DatabaseNotConfigured />
    </div>
  ),
};

export const Skeletons: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-6">
      <PageSkeleton cards={1} />
      <Skeleton className="h-9 w-40" />
    </div>
  ),
};

export const Spinners: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-navy-800">
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <Spinner className="size-8" label="Loading" />
    </div>
  ),
};

export const Confirm: Story = {
  render: () => (
    <ConfirmDialog
      trigger={<Button variant="destructive">Cancel booking</Button>}
      title="Cancel this booking?"
      description="This writes to the append-only custody log and cannot be undone."
      confirmLabel="Cancel booking"
      destructive
      onConfirm={() => new Promise((resolve) => setTimeout(resolve, 800))}
    />
  ),
};
