import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AutocompleteField, type AutocompleteSuggestion } from "./autocomplete-field";
import { Label } from "./label";

const ADDRESSES: AutocompleteSuggestion[] = [
  { id: "1", label: "22 W 34th St", hint: "New York, NY, USA" },
  { id: "2", label: "22 W 34th St Apt 4B", hint: "New York, NY, USA" },
  { id: "3", label: "220 W 34th St", hint: "New York, NY, USA" },
  { id: "4", label: "22 W 43rd St", hint: "New York, NY, USA" },
];

/**
 * The typeahead behind the funnel's address step. The component owns the list
 * behaviour and the ARIA wiring; the caller owns where suggestions come from,
 * which is why these stories can drive it with a plain array.
 */
const meta = {
  title: "Forms/AutocompleteField",
  component: AutocompleteField,
} satisfies Meta<typeof AutocompleteField>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({
  suggestions,
  ...props
}: Partial<React.ComponentProps<typeof AutocompleteField>> & {
  suggestions: AutocompleteSuggestion[];
}) {
  const [value, setValue] = React.useState("22 W 34");
  return (
    <div className="max-w-md">
      <Label htmlFor="street">Street address</Label>
      <AutocompleteField
        id="street"
        name="line1"
        value={value}
        onValueChange={setValue}
        suggestions={suggestions}
        onSelect={(suggestion) => setValue(suggestion.label)}
        {...props}
      />
    </div>
  );
}

/** Type, arrow down, Enter. Clicking a row works too. */
export const Suggesting: Story = {
  args: { value: "", onValueChange: () => {}, suggestions: [], onSelect: () => {} },
  render: () => <Harness suggestions={ADDRESSES} />,
};

/** A request in flight. The field stays fully typable — suggesting never gates. */
export const Loading: Story = {
  args: { value: "", onValueChange: () => {}, suggestions: [], onSelect: () => {} },
  render: () => <Harness suggestions={[]} loading />,
};

/** Settled with nothing found: say so, and let them keep typing. */
export const NoMatches: Story = {
  args: { value: "", onValueChange: () => {}, suggestions: [], onSelect: () => {} },
  render: () => (
    <Harness
      suggestions={[]}
      showEmpty
      emptyMessage="No matches — type the address in full and we will take it from there."
    />
  ),
};
