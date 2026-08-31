import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { LiveMap, type MapDriver } from "./live-map";

/**
 * The map the customer watches a van arrive on.
 *
 * These stories exist because the map's real home — a trip page with a sealed
 * booking and an open driver shortlist — takes a seeded database and four
 * clicks to reach, which is exactly the kind of surface that quietly rots.
 * Here it is one click, with the two states that matter side by side.
 *
 * Real coordinates: the pickup is on West 34th Street and the vans are
 * scattered around Midtown, so the frame, the zoom and the pin sizes are
 * being judged against the density they will actually meet.
 */
const PICKUP = { lat: 40.7505, lng: -73.9877 };

const DRIVERS: MapDriver[] = [
  { id: "a", position: { lat: 40.7589, lng: -73.9851 }, label: "Marcus" },
  { id: "b", position: { lat: 40.7411, lng: -73.9897 }, label: "Yara" },
  { id: "c", position: { lat: 40.7549, lng: -73.9997 }, label: "Ben" },
];

const meta = {
  title: "Tracking/LiveMap",
  component: LiveMap,
} satisfies Meta<typeof LiveMap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Choosing: several vans, one of them highlighted by a click. */
export const ChoosingADriver: Story = {
  render: function Choosing() {
    const [focused, setFocused] = React.useState<string | null>(null);
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <LiveMap
          pickup={PICKUP}
          drivers={DRIVERS.map((d) => ({ ...d, selected: d.id === focused }))}
          onDriverClick={setFocused}
          className="h-80"
          label="Map showing your pickup address and three available drivers"
        />
        <p className="text-sm text-muted-foreground">
          {focused
            ? `${DRIVERS.find((d) => d.id === focused)?.label} is highlighted. On the trip page this scrolls their card into view — the map never books anything.`
            : "Tap a van."}
        </p>
      </div>
    );
  },
  args: { pickup: PICKUP, label: "" },
};

/** Tracking: one chosen driver, moving. */
export const TrackingOneDriver: Story = {
  args: {
    pickup: PICKUP,
    drivers: [{ ...DRIVERS[0]!, selected: true }],
    className: "h-80",
    label: "Map showing Marcus on the way to your pickup address",
  },
};

/**
 * Nobody has pinged yet. The door still draws — this is the state a customer
 * sees between a driver being chosen and their phone reporting a first fix.
 */
export const NoDriversYet: Story = {
  args: {
    pickup: PICKUP,
    drivers: [],
    className: "h-80",
    label: "Map showing your pickup address",
  },
};
