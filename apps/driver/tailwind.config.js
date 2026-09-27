const tokens = require("./tailwind.tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: tokens.colors,
      borderRadius: tokens.borderRadius,
      fontFamily: {
        sans: ["Inter_400Regular"],
        display: ["Sora_600SemiBold"],
        mono: ["Menlo"],
      },
    },
  },
  plugins: [({ addBase }) => addBase({ ":root": tokens.vars.light })],
};
