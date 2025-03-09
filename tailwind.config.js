/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "rgb(147, 51, 234)", // purple-600
          foreground: "rgb(243, 232, 255)", // purple-50
        },
        secondary: {
          DEFAULT: "rgb(39, 39, 42)", // zinc-800
          foreground: "rgb(243, 232, 255)", // purple-50
        },
        destructive: {
          DEFAULT: "rgb(220, 38, 38)", // red-600
          foreground: "rgb(254, 242, 242)", // red-50
        },
        muted: {
          DEFAULT: "rgb(24, 24, 27)", // zinc-900
          foreground: "rgb(216, 180, 254)", // purple-300
        },
        accent: {
          DEFAULT: "rgb(147, 51, 234)", // purple-600
          foreground: "rgb(243, 232, 255)", // purple-50
        },
        popover: {
          DEFAULT: "rgb(24, 24, 27)", // zinc-900
          foreground: "rgb(243, 232, 255)", // purple-50
        },
        card: {
          DEFAULT: "rgb(24, 24, 27)", // zinc-900
          foreground: "rgb(243, 232, 255)", // purple-50
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      gridTemplateColumns: {
        16: "repeat(16, minmax(0, 1fr))",
      },
      screens: {
        xs: "480px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

