import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppFooter, AppHeader, ContentColumn } from "./app-shell";
import { BackLink } from "./back-link";
import { BookingStatusBadge } from "./booking-status-badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { PageHeader } from "./page-header";

const meta = {
  title: "Shell",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full standardized frame, as every in-app page composes it. */
export const FullFrame: Story = {
  render: () => (
    <div className="min-h-dvh">
      <AppHeader
        links={[
          { href: "#", label: "Overview" },
          { href: "#", label: "Bookings" },
        ]}
        actions={
          <Button variant="ghost" size="sm">
            Sign out
          </Button>
        }
      />
      <ContentColumn>
        <BackLink href="#" className="self-start">
          All trips
        </BackLink>
        <PageHeader
          title="UA 1189 · EWR"
          subtitle="Sat 2 Aug, 6:10 PM · 2 bags · T. Traveler"
          actions={<BookingStatusBadge status="in_transit" />}
        />
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Chain of custody</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Content sits in one standard column; chrome spans the full container.
          </CardContent>
        </Card>
      </ContentColumn>
      <AppFooter>
        Every pickup is ID-verified, sealed with a serialized tag, and photographed at
        each hand-off.
      </AppFooter>
    </div>
  ),
};

export const StatusBadges: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {[
        "draft",
        "paid",
        "agent_assigned",
        "verified_sealed",
        "awaiting_pickup",
        "in_transit",
        "delivered_to_bagdrop",
        "completed",
        "exception",
        "cancelled",
      ].map((status) => (
        <BookingStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
