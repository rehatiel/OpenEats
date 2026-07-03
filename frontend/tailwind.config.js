/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Archivo Variable', 'Archivo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        // Palette A — "Front Counter": bright, daylight-legible register/admin theme.
        counter: {
          paper: '#F2EDE3',
          card: '#FFFFFF',
          cream: '#F8F5EF',
          ink: '#211D18',
          orange: '#EF5A26',
          'orange-dark': '#B23C14',
          paid: '#17845A',
          'paid-dark': '#0F5D3F',
          dinein: '#2563EB',
          delivery: '#7C3AED',
          line: '#E2DACC',
          grid: '#E7E0D1',
          dashed: '#D8CFBD',
          tabs: '#EFE9DD',
          muted: '#8A7F6C',
          'muted-2': '#6B6459',
          faint: '#A89C88',
        },
        // Palette B — "Kitchen/KDS": high-contrast, readable from a few feet away.
        kds: {
          bg: '#0D0F12',
          card: '#1B1F26',
          'card-2': '#22242B',
          'done-bg': '#141C17',
          text: '#F4F6F8',
          dinein: '#3B82F6',
          togo: '#FB7A3C',
          delivery: '#A855F7',
          cooking: '#F5A524',
          ready: '#22C55E',
          late: '#EF4444',
          muted: '#9AA4B2',
          'muted-2': '#7F8A99',
          border: '#2B313A',
          strike: '#3A4150',
        },
      },
    },
  },
  plugins: [],
};
