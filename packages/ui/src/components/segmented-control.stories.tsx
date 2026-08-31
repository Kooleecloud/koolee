import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SegmentedControl } from "./segmented-control";

/**
 * The control both consoles now share.
 *
 * These stories exist because the two real callers are hard to reach — the
 * customer's map/list switch needs a sealed booking with two positioned
 * drivers, and the agent's schedule/history switch needs an assigned task —
 * so the control itself would otherwise only ever be looked at by accident.
 *
 * What to check by hand: the active tab reads as RAISED rather than merely
 * tinted (squint, or turn the screen brightness down — that is the failure
 * mode a colour-only active state has), the tabs stay equal width as labels
 * grow, and a keyboard can reach and operate both.
 */
const meta = {
  title: "Controls/SegmentedControl",
  component: SegmentedControl,
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The customer's driver shortlist: a view preference, so buttons and state. */
export const MapOrList: Story = {
  render: function MapOrListStory() {
    const [view, setView] = React.useState<"map" | "list">("map");
    return (
      <div className="flex max-w-md flex-col gap-3">
        <SegmentedControl
          items={[
            { value: "map", label: "Map" },
            // The count sits on the LIST tab alone: the list holds every
            // driver, and the map can only draw the ones who have reported a
            // position. Two numbers would read as a discrepancy.
            { value: "list", label: "List · 4" },
          ]}
          value={view}
          onChange={setView}
          label="Map or list"
          className="sm:max-w-56"
        />
        <p className="text-sm text-muted-foreground">
          Showing the <strong>{view}</strong>.
        </p>
      </div>
    );
  },
  args: { items: [], value: "map", label: "" },
};

/**
 * The agent's schedule: tabs that are URLs, so anchors.
 *
 * `linkComponent` is Next's `Link` in the app; here it is a plain anchor,
 * which is the documented fallback and what makes the component usable
 * outside a router.
 */
export const TabsThatAreUrls: Story = {
  render: () => (
    <SegmentedControl
      items={[
        { value: "todo", label: "To do · 3", href: "/tasks" },
        { value: "history", label: "History · 12", href: "/tasks?view=history" },
      ]}
      value="todo"
      label="Schedule or history"
      className="max-w-sm"
    />
  ),
  args: { items: [], value: "todo", label: "" },
};

/** Long labels: the tabs share the width rather than one of them winning. */
export const LongLabels: Story = {
  render: () => (
    <SegmentedControl
      items={[
        { value: "a", label: "Everything happening today" },
        { value: "b", label: "Finished" },
      ]}
      value="a"
      label="Example"
      className="max-w-lg"
    />
  ),
  args: { items: [], value: "a", label: "" },
};
