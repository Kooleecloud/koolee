import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CheckboxField } from "./checkbox";
import { MultiSelect, type MultiSelectOption } from "./multi-select";

// Render-only stories: every example builds its own markup (a full table /
// a stateful harness), so args are supplied by `render`, not by Storybook.
const meta: Meta<typeof MultiSelect> = {
  title: "Forms/MultiSelect",
  component: MultiSelect,
};

export default meta;
type Story = StoryObj;

const STATUSES: MultiSelectOption[] = [
  { value: "draft", label: "draft" },
  { value: "paid", label: "paid" },
  { value: "agent_assigned", label: "agent_assigned" },
  { value: "verified_sealed", label: "verified_sealed" },
  { value: "in_transit", label: "in_transit" },
  { value: "completed", label: "completed" },
  { value: "exception", label: "exception" },
  { value: "cancelled", label: "cancelled" },
];

const AIRPORTS: MultiSelectOption[] = [
  { value: "JFK", label: "JFK", hint: "John F. Kennedy" },
  { value: "LGA", label: "LGA", hint: "LaGuardia" },
  { value: "EWR", label: "EWR", hint: "Newark Liberty" },
];

/** Selection is controlled, so a story needs to own it. */
function Harness({
  options,
  label,
  allLabel,
  initial = [],
}: {
  options: MultiSelectOption[];
  label: string;
  allLabel: string;
  initial?: string[];
}) {
  const [selected, setSelected] = React.useState<string[]>(initial);
  return (
    <div className="flex flex-col gap-3">
      <MultiSelect
        label={label}
        allLabel={allLabel}
        options={options}
        selected={selected}
        onChange={setSelected}
        className="w-64"
      />
      <p className="text-xs text-muted-foreground">
        selected: {selected.length > 0 ? selected.join(", ") : "(none — no constraint)"}
      </p>
    </div>
  );
}

export const Empty: Story = {
  render: () => <Harness label="Status" allLabel="All statuses" options={STATUSES} />,
};

/** One selection borrows the option's own label rather than saying "1 selected". */
export const SingleSelection: Story = {
  render: () => (
    <Harness
      label="Status"
      allLabel="All statuses"
      options={STATUSES}
      initial={["exception"]}
    />
  ),
};

export const ManySelected: Story = {
  render: () => (
    <Harness
      label="Status"
      allLabel="All statuses"
      options={STATUSES}
      initial={["paid", "agent_assigned", "exception"]}
    />
  ),
};

export const WithHints: Story = {
  render: () => (
    <Harness
      label="Airport"
      allLabel="All airports"
      options={AIRPORTS}
      initial={["JFK"]}
    />
  ),
};

/** How the bookings board composes them: two pickers plus a plain checkbox. */
export const FilterBar: Story = {
  render: function FilterBarStory() {
    const [statuses, setStatuses] = React.useState<string[]>(["paid"]);
    const [airports, setAirports] = React.useState<string[]>([]);
    const [today, setToday] = React.useState(false);

    return (
      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          label="Status"
          allLabel="All statuses"
          options={STATUSES}
          selected={statuses}
          onChange={setStatuses}
          className="w-56"
        />
        <MultiSelect
          label="Airport"
          allLabel="All airports"
          options={AIRPORTS}
          selected={airports}
          onChange={setAirports}
          className="w-52"
        />
        <CheckboxField
          label="Today's pickups only"
          checked={today}
          onChange={(event) => setToday(event.target.checked)}
        />
      </div>
    );
  },
};
