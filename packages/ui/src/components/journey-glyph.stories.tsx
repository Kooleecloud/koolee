import type { Meta, StoryObj } from "@storybook/react-vite";

import { JourneyGlyph, type JourneyGlyphName } from "./journey-glyph";

/**
 * The four step glyphs. Kept in one story so the family can be eyeballed
 * together: they are meant to share weight, optical size and palette, and a
 * single glyph edited in isolation is how a set stops looking like a set.
 */
const meta = {
  title: "Marketing/JourneyGlyph",
  component: JourneyGlyph,
} satisfies Meta<typeof JourneyGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

const NAMES: JourneyGlyphName[] = ["book", "seal", "track", "deliver"];

export const All: Story = {
  args: { name: "book" },
  render: () => (
    <ul className="flex flex-wrap gap-8">
      {NAMES.map((name) => (
        <li key={name} className="flex flex-col items-center gap-3">
          <JourneyGlyph name={name} className="h-14" />
          <span className="font-mono text-xs tracking-widest text-navy-500 uppercase">
            {name}
          </span>
        </li>
      ))}
    </ul>
  ),
};

/** Only `seal` may carry tag orange — there it is the physical seal. */
export const Seal: Story = {
  args: { name: "seal", className: "h-24" },
};

/** At card size (the size they actually ship at). */
export const CardSize: Story = {
  args: { name: "track", className: "h-11" },
};
