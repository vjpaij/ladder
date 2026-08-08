/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        obsidian: {
          950: '#06080D',
          900: '#0B0F17',
          850: '#101622',
          800: '#161D2C',
          700: '#212A3D',
          600: '#323E56',
        },
        emerald: {
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          glow: '#00F59B',
        },
        crimson: {
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          glow: '#FF4757',
        },
        indigo: {
          500: '#6366F1',
          600: '#4F46E5',
          glow: '#7064FF',
        }
      },
      boxShadow: {
        'glow-emerald': '0 0 25px -5px rgba(0, 245, 155, 0.25)',
        'glow-crimson': '0 0 25px -5px rgba(255, 71, 87, 0.25)',
        'glow-indigo': '0 0 25px -5px rgba(99, 102, 241, 0.25)',
        'glass-card': '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
        'glass-card-light': '0 8px 32px 0 rgba(15, 23, 42, 0.08)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
      }
    },
  },
  plugins: [],
}
