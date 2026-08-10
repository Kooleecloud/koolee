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
            Content spans the same container as the chrome; pages arrange cards in grids
            and cap forms at readable widths.
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

/**
 * The staff-console header: `tag` chip after the wordmark tells the ops and
 * agent surfaces apart (they are otherwise identical chrome, especially on
 * the login screens), and the session sign-out lives in the actions slot.
 */
export const TaggedFrame: Story = {
  render: () => (
    <div className="min-h-dvh">
      <AppHeader
        tag="ops"
        links={[
          { href: "#", label: "Overview" },
          { href: "#", label: "Bookings" },
          { href: "#", label: "Exceptions" },
          { href: "#", label: "Staff" },
        ]}
        actions={
          <Button variant="ghost" size="sm">
            Sign out
          </Button>
        }
      />
      <ContentColumn>
        <PageHeader
          title="Koolee Ops"
          subtitle="The tag chip is the only chrome difference between staff consoles."
        />
      </ContentColumn>
    </div>
  ),
};

/**
 * The customer-app header config (3 links + CTA) on a small phone. Nav and
 * actions collapse behind the hamburger below `md`; nothing overflows the
 * 320px viewport. Regression story for the mobile header overflow bug.
 */
export const MobileFrame: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="min-h-dvh">
      <AppHeader
        links={[
          { href: "#", label: "Profile" },
          { href: "#", label: "Addresses" },
          { href: "#", label: "Trips" },
        ]}
        actions={
          <Button variant="ghost" size="sm">
            Book a pickup
          </Button>
        }
      />
      <ContentColumn>
        <PageHeader
          title="Your trips"
          subtitle="Open the menu to reach Profile, Addresses, and Trips."
        />
      </ContentColumn>
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

/**
 * The four content widths, side by side. `full` is the one worth eyeballing:
 * it is genuinely full-bleed (no 1280px cap) because dense operational tables
 * want the viewport. It used to be a silent alias of `default`.
 */
export const ContentWidths: Story = {
  render: () => (
    <div className="flex flex-col gap-4 py-6">
      {(["full", "default", "focused", "narrow"] as const).map((width) => (
        <ContentColumn key={width} as="div" width={width} className="py-0">
          <div className="rounded-md border border-dashed border-sky-400 bg-sky-50 px-3 py-2 text-xs">
            <code>width=&quot;{width}&quot;</code>
            {width === "full" ? " — full-bleed, own gutters, no cap" : null}
            {width === "default" ? " — container, capped at 1280px" : null}
          </div>
        </ContentColumn>
      ))}
    </div>
  ),
};
