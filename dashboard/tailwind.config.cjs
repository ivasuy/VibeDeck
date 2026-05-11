/** @type {import("tailwindcss").Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        oai: [
          "'Plus Jakarta Sans'",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
        display: [
          "'Outfit'",
          "'Plus Jakarta Sans'",
          "var(--oai-font-sans)",
        ],
        mono: [
          "'JetBrains Mono'",
          "'Fira Code'",
          "'SF Mono'",
          "ui-monospace",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        // Display sizes - for hero metrics
        display: [
          "72px",
          {
            lineHeight: "1",
            fontWeight: "700",
            letterSpacing: "-0.03em",
          },
        ],
        "display-sm": [
          "56px",
          {
            lineHeight: "1.05",
            fontWeight: "700",
            letterSpacing: "-0.02em",
          },
        ],
        hero: [
          "48px",
          {
            lineHeight: "1.1",
            fontWeight: "600",
            letterSpacing: "-0.02em",
          },
        ],
        h1: [
          "36px",
          {
            lineHeight: "1.2",
            fontWeight: "600",
            letterSpacing: "-0.02em",
          },
        ],
        h2: [
          "28px",
          {
            lineHeight: "1.25",
            fontWeight: "600",
            letterSpacing: "-0.01em",
          },
        ],
        h3: [
          "22px",
          {
            lineHeight: "1.3",
            fontWeight: "600",
            letterSpacing: "-0.01em",
          },
        ],
        h4: [
          "18px",
          {
            lineHeight: "1.4",
            fontWeight: "600",
          },
        ],
        body: [
          "16px",
          {
            lineHeight: "1.5",
            fontWeight: "400",
          },
        ],
        "body-sm": [
          "14px",
          {
            lineHeight: "1.5",
            fontWeight: "400",
          },
        ],
        caption: [
          "12px",
          {
            lineHeight: "1.4",
            fontWeight: "500",
            letterSpacing: "0.01em",
          },
        ],
        label: [
          "11px",
          {
            lineHeight: "1.3",
            fontWeight: "600",
            letterSpacing: "0.02em",
          },
        ],
      },
      colors: {
        oai: {
          black: "#0a0a0a",
          white: "#fafafa",
          gray: {
            50: "#fafafa",
            100: "#f5f5f5",
            200: "#e5e5e5",
            300: "#d4d4d4",
            400: "#a3a3a3",
            500: "#737373",
            600: "#525252",
            700: "#404040",
            800: "#262626",
            900: "#171717",
            950: "#0a0a0a",
          },

          brand: {
            DEFAULT: "#5b5fc7",
            dark: "#4f46a8",
            light: "#818cf8",
            50: "#f5f5ff",
            100: "#ededff",
            200: "#d4d4ff",
            300: "#a5b4fc",
            400: "#818cf8",
            500: "#6366f1",
            600: "#5b5fc7",
            700: "#4f46a8",
            800: "#3b3686",
            900: "#312e6a",
            950: "#1e1b4b",
          },
          // Supporting accent — muted indigo (30%)
          forest: {
            DEFAULT: "#6366f1",
            dark: "#5b5fc7",
            light: "#818cf8",
            50: "#f5f5ff",
          },
          // Secondary accents (10%)
          amber: {
            DEFAULT: "#f59e0b",
            dark: "#d97706",
            light: "#fbbf24",
            50: "#fffbeb",
          },
          // Semantic colors
          success: "#22c55e",
          warning: "#f59e0b",
          error: "#ef4444",
          info: "#5b5fc7",
          // Legacy blue
          blue: {
            DEFAULT: "#5b5fc7",
            dark: "#4f46a8",
            light: "#6d72c9",
            50: "#f5f5ff",
          },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "star-movement-bottom": "star-movement-bottom linear infinite alternate",
        "star-movement-top": "star-movement-top linear infinite alternate",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "star-movement-bottom": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(-100%, 0%)", opacity: "0" },
        },
        "star-movement-top": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(100%, 0%)", opacity: "0" },
        },
      },
      boxShadow: {
        "oai-sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        "oai": "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
        "oai-md": "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
        "oai-lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
        "glass": "var(--glass-shadow)",
        "glass-glow": "var(--glass-shadow), var(--glass-glow)",
      },
      backdropBlur: {
        glass: "var(--glass-blur)",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      spacing: {
        0: "0",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px",
        20: "80px",
      },
    },
  },
  plugins: [],
};
