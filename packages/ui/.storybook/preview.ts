import type { Preview } from "@storybook/react-vite";

import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      options: {
        light: { name: "light", value: "#ffffff" },
        navy: { name: "navy", value: "#0B2545" },
      },
    },
  },
};

export default preview;
