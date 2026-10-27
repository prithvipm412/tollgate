export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(
        ["base", "surface", "accent", "allow", "hold", "block"].map((name) => [
          name,
          `rgb(var(--${name}) / <alpha-value>)`,
        ]),
      ),
    },
  },
};
