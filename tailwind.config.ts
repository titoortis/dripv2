import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0A0A0B",
          900: "#0F0F11",
          800: "#16161A",
          700: "#1E1E24",
          600: "#26262E",
          500: "#3A3A45",
          400: "#6F6F7A",
          300: "#9A9AA5",
          200: "#C8C8CF",
          100: "#E8E8EC",
          50: "#F4F4F6",
        },
        accent: {
          DEFAULT: "#D6F24A",
          ink: "#0A0A0B",
          hover: "#C7E63B",
        },
        danger: "#FF5A5F",
        warn: "#FFB74A",
        ok: "#5CE7A0",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          "Instrument Serif",
          "Iowan Old Style",
          "Apple Garamond",
          "Georgia",
          "serif",
        ],
      },
      letterSpacing: {
        ultratight: "-0.04em",
      },
      borderRadius: {
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        sheet: "0 -10px 30px rgba(0,0,0,0.45)",
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-soft": "pulseSoft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
