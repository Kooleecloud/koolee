import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./avatar";

const meta = {
  title: "Primitives/Avatar",
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A 1×1 transparent PNG — enough to prove the image path renders. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const Sizes: Story = {
  args: { name: "Ana Maria Ruiz" },
  render: () => (
    <div className="flex items-end gap-4">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Avatar key={size} size={size} name="Ana Maria Ruiz" />
      ))}
    </div>
  ),
};

/**
 * The fallback IS the design. Most people have no photo, and the tint is
 * derived from the name so the same person is the same colour on every screen.
 */
export const InitialsAndTints: Story = {
  args: { name: "Ana Maria Ruiz" },
  render: () => (
    <div className="flex gap-3">
      {["Ana Maria Ruiz", "Leo Fernandes", "Priya S", "Marcus Webb", "Dana"].map(
        (name) => (
          <div key={name} className="flex flex-col items-center gap-1.5">
            <Avatar size="lg" name={name} />
            <span className="text-xs text-muted-foreground">{name}</span>
          </div>
        ),
      )}
    </div>
  ),
};

export const WithPhoto: Story = {
  args: { name: "Ana Maria Ruiz", src: PIXEL, size: "xl" },
};

/**
 * Signed URLs expire — the `avatars` bucket is private and the TTL is an hour,
 * so a stale page WILL hand this component a URL that 403s. It must land on
 * the initials rather than a broken-image glyph.
 */
export const BrokenSignedUrl: Story = {
  args: {
    name: "Ana Maria Ruiz",
    src: "https://example.invalid/expired-signed-url.jpg",
    size: "xl",
  },
};

/** No photo and no name — a customer who has filled in nothing yet. */
export const Anonymous: Story = {
  args: { name: null, size: "xl" },
};
