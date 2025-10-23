/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-white': '#FFFFFF',    // Main background
        'brand-blue': '#00F0FF',     // Neon blue (matches logo)
        'brand-navy': '#0A0F1C',     // Deep navy (for text/background)
        'brand-cyan': '#A2F9FF',     // Accent cyan
        'brand-green': '#00FF66',    // Success/confirmation
        'brand-yellow': '#FFDD00',   // Badges/highlights
        'brand-slate': '#8892B0',    // Subdued text
        'brand-lime': '#B4FF3A',     // Progress/glow
        'brand-purple': '#744CE0',   // Optional accent
        // Legacy support
        brand: {
          blue: "#00F0FF",
          navy: "#0A0F1C",
          cyan: "#A2F9FF",
          white: "#FFFFFF",
        },
        'intelliwatt-blue': '#00F0FF',
        'intelliwatt-cyan': '#A2F9FF',
      },
    },
  },
  plugins: [],
} 