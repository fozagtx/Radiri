import { createSystem, defaultConfig, defineConfig, defineRecipe } from "@chakra-ui/react";

/**
 * Radiri theme for Chakra UI: cream background, ink foreground, white panels, Geist for text and
 * figures, Instrument Serif for display titles. Light only; the brand has no dark palette.
 */
const config = defineConfig({
  globalCss: {
    "html, body": { bg: "bg", color: "fg", fontFamily: "body" },
  },
  theme: {
    recipes: {
      // One plain button type style everywhere: Geist, medium weight, sentence case, no tracking tricks.
      button: defineRecipe({
        base: { fontFamily: "body", fontWeight: "medium", letterSpacing: "normal", textTransform: "none" },
        variants: {
          size: {
            md: { textStyle: "sm" },
            lg: { textStyle: "sm" },
            xl: { textStyle: "md" },
          },
        },
      }),
    },
    tokens: {
      fonts: {
        heading: { value: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" },
        body: { value: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" },
        mono: { value: "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace" },
        display: { value: "var(--font-display), Georgia, serif" },
      },
      colors: {
        ink: { value: "#191919" },
        cream: { value: "#fbfaf5" },
        meme: { value: "#4f9843" },
        stock: { value: "#2f4fa8" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: "#fbfaf5" },
          panel: { value: "#ffffff" },
          subtle: { value: "#f5f4ef" },
          muted: { value: "#eeece5" },
          emphasized: { value: "#e4e1d8" },
        },
        fg: {
          DEFAULT: { value: "#191919" },
          muted: { value: "#5b5b5b" },
          subtle: { value: "#8a8a86" },
        },
        border: {
          DEFAULT: { value: "rgba(25, 25, 25, 0.1)" },
          muted: { value: "rgba(25, 25, 25, 0.06)" },
          emphasized: { value: "rgba(25, 25, 25, 0.2)" },
        },
      },
      shadows: {
        panel: { value: "0 1px 2px rgba(25,25,25,0.04), 0 12px 32px -18px rgba(25,25,25,0.22)" },
        lift: { value: "0 2px 4px rgba(25,25,25,0.05), 0 24px 48px -24px rgba(25,25,25,0.35)" },
      },
      radii: {
        panel: { value: "1.25rem" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
