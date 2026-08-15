import type { Meta, StoryObj } from "@storybook/react-vite";

import { ImageLightbox } from "./image-lightbox";

const meta = {
  title: "Primitives/ImageLightbox",
  component: ImageLightbox,
} satisfies Meta<typeof ImageLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stand-in for a bag photo — no network in stories. */
const SAMPLE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
       <rect width="1200" height="900" fill="#1e5ac8"/>
       <rect x="80" y="80" width="1040" height="740" fill="none" stroke="#fff" stroke-width="14"/>
       <text x="160" y="470" font-family="Helvetica" font-size="96" fill="#fff">BAG 1</text>
     </svg>`,
  );

/** How ops sees it in the Bags &amp; seals card — a small square crop. */
export const OpsThumbnail: Story = {
  args: {
    src: SAMPLE,
    alt: "Bag 1 evidence photo",
    title: "Bag 1",
    description: "seal KL-2001 · 18.5 kg",
    className: "h-20 w-20",
  },
};

/** The larger crop used inside the custody trail. */
export const CustodyTrail: Story = {
  args: {
    src: SAMPLE,
    alt: "Custody evidence",
    title: "Bag sealed",
    description: "Sat 15 Aug, 9:06 AM EDT · agent",
    className: "h-48 w-48",
  },
};

/** The agent's own capture, checked before they commit the seal. */
export const AgentPreview: Story = {
  args: {
    src: SAMPLE,
    alt: "The bag you just photographed",
    title: "Bag photo",
    description: "Tap Retake if this is blurred or shows the wrong bag.",
    className: "h-24 w-24",
  },
};
