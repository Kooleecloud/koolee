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

/**
 * Choosing, as the trip page actually renders it: every control on, a card
 * anchored to the tapped pin, and the recenter button one drag away.
 *
 * THIS IS THE STORY TO OPEN WHEN TOUCHING THE PINS. Two bugs have now been
 * found by screenshotting it and nothing else — a worker that never loaded,
 * and a pin that flickered because `transition-transform` sat on the element
 * MapLibre rewrites every frame. Typecheck, lint and the production build were
 * green over both.
 *
 * What to check by hand:
 *  - hover a van: it grows SMOOTHLY and does not jitter or lag the map;
 *  - drag the map away: "Back to my pickup" appears at the bottom left, and
 *    the map stops re-framing itself on its own;
 *  - tap that button: the frame returns and the button goes;
 *  - ONE finger on a touch device pans the map (it no longer scrolls the
 *    page — see the gesture note in `live-map.tsx`), and a pinch zooms;
 *  - a mouse WHEEL over the map scrolls the page rather than zooming it, so
 *    a laptop cannot get caught on the way past. Zoom is the +/− buttons.
 */
export const ChoosingADriver: Story = {
  render: function Choosing() {
    const [focused, setFocused] = React.useState<string | null>(null);
    const driver = DRIVERS.find((d) => d.id === focused);
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <LiveMap
          pickup={PICKUP}
          drivers={DRIVERS.map((d) => ({ ...d, selected: d.id === focused }))}
          onDriverClick={setFocused}
          popupDriverId={focused}
          onPopupClose={() => setFocused(null)}
          renderPopup={(id) => {
            const found = DRIVERS.find((d) => d.id === id);
            return (
              <div className="flex w-56 flex-col gap-2 p-4">
                <p className="text-sm font-medium">{found?.label}</p>
                <p className="text-xs text-muted-foreground">
                  Sprinter · room for 4 more bags after yours · about 15 min
                </p>
                <button
                  type="button"
                  className="mt-1 w-full rounded-md bg-navy-800 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Choose {found?.label}
                </button>
              </div>
            );
          }}
          allowFullscreen
          className="h-80"
          label="Map showing your pickup address and three available drivers"
        />
        <p className="text-sm text-muted-foreground">
          {driver
            ? `${driver.label}'s card is anchored to their pin. On the trip page that card's button is the one that books — the map itself never does.`
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
 * A driver reporting a new fix every few seconds, so the walk between them is
 * visible without waiting out a real 20-second ping.
 *
 * This is the story to open when touching `walkMarker`: the pin should ease
 * from block to block rather than blink, and a `prefers-reduced-motion`
 * browser should show it jumping instead, with nothing else different.
 */
export const DriverMoving: Story = {
  render: function Moving() {
    const [at, setAt] = React.useState(DRIVERS[0]!.position);

    React.useEffect(() => {
      // Roughly a block south-west each tick — the scale of a 20-second
      // en-route ping, compressed so the animation is watchable.
      const id = setInterval(() => {
        setAt((current) => ({
          lat: current.lat - 0.0016,
          lng: current.lng - 0.0009,
        }));
      }, 2500);
      return () => clearInterval(id);
    }, []);

    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <LiveMap
          pickup={PICKUP}
          drivers={[{ id: "moving", position: at, label: "Marcus", selected: true }]}
          className="h-80"
          label="Map showing Marcus on the way to your pickup address"
        />
        <p className="text-sm text-muted-foreground">
          A new fix every 2.5s. The pin should WALK, not blink.
        </p>
      </div>
    );
  },
  args: { pickup: PICKUP, label: "" },
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

/**
 * SEARCHING — the state that used to be a text card and no map at all.
 *
 * Three anonymous placeholders around the door while the shortlist is being
 * built. Open this one to check the things a screenshot cannot:
 *
 *  - they look like REAL PINS — same pill, same truck glyph, same pulse. That
 *    is the point: an earlier grey dot read as a different kind of object and
 *    looked, in TD's words, "way more fake" than a placeholder needs to;
 *  - the LABEL is what separates them. A masked initial — "R****" — is
 *    visibly withheld information rather than an invented person;
 *  - they are UNCLICKABLE. Tap one; nothing should happen, no cursor change,
 *    no card. A ghost renders a `span` rather than a `button`, inside a
 *    `pointer-events-none` root, so the inertness is structural;
 *  - THEY DO NOT MOVE. They used to drift on a shared counter, which made all
 *    three set off at the same instant in the same direction. The pulse is the
 *    motion now.
 *
 * Positions and labels are generated in the app from the booking id — see
 * `apps/web/src/lib/ghost-drivers.ts` — so a page refreshing every few seconds
 * does not scatter them. These are hand-placed.
 */
export const SearchingForDrivers: Story = {
  args: {
    pickup: PICKUP,
    drivers: [
      {
        id: "ghost-0",
        position: { lat: 40.7561, lng: -73.9903 },
        label: "R****",
        variant: "ghost",
      },
      {
        id: "ghost-1",
        position: { lat: 40.7455, lng: -73.9812 },
        label: "M****",
        variant: "ghost",
      },
      {
        id: "ghost-2",
        position: { lat: 40.7522, lng: -73.9975 },
        label: "T****",
        variant: "ghost",
      },
    ],
    className: "h-80",
    label: "Map showing your pickup address while we find a driver",
  },
};

/**
 * A LAST KNOWN POSITION, not a current one.
 *
 * The case that used to empty the map: core nulled any fix past the 90-second
 * freshness window, so a driver whose phone went into a pocket took the whole
 * map with them at the moment somebody was watching hardest.
 *
 * What to check by hand — the two pins must not be mistakable for each other:
 *
 *  - the stale pin is GREY and does NOT pulse. The ring is what says "this is
 *    now", so keeping it on an old fix would make the one dishonest pin the
 *    liveliest thing on screen;
 *  - it is still tappable and still named — it is a real driver, and the age
 *    is said in words by the caller, not implied by the colour alone;
 *  - a screen reader announces it as "— last known position". Colour is not
 *    available to everyone and the distinction is the whole point.
 */
export const StalePosition: Story = {
  args: {
    pickup: PICKUP,
    drivers: [
      { id: "a", position: { lat: 40.7589, lng: -73.9851 }, label: "Marcus" },
      {
        id: "b",
        position: { lat: 40.7411, lng: -73.9897 },
        label: "Yara",
        variant: "stale",
      },
    ],
    className: "h-80",
    label: "Map showing two drivers, one with an old position",
  },
};
