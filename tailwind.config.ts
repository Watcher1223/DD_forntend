import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Playfair Display', 'Cinzel', 'serif'],
        story: ['Lora', 'Crimson Text', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        parchment: '#fef3c7',
        'parchment-dim': '#f4e8c1',
        ink: '#1e293b',
        blood: '#8b0000',
        gold: '#d4a853',
        'gold-soft': '#e8c97a',
        lavender: '#a78bfa',
        'lavender-soft': '#c4b5fd',
        'soft-pink': '#f9a8d4',
        'soft-pink-muted': '#fbcfe8',
        midnight: '#0f172a',
        'midnight-light': '#1e293b',
        ember: '#e25822',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(201,169,110,0.2)' },
          '100%': { boxShadow: '0 0 40px rgba(201,169,110,0.5)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
