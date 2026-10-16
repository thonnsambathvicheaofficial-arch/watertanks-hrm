import type { Config } from 'tailwindcss'

const token = (name: string) => `oklch(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-plex)', 'var(--font-khmer)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: token('paper'),
        raised: token('raised'),
        ink: { DEFAULT: token('ink'), soft: token('ink-soft'), faint: token('ink-faint') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        brand: { DEFAULT: token('brand'), deep: token('brand-deep'), wash: token('brand-wash') },
        ruby: token('ruby'),
        steel: { DEFAULT: token('steel'), raised: token('steel-raised'), line: token('steel-line'), text: token('steel-text'), soft: token('steel-soft') },
        // Attendance status colours. Each has a solid (text / dot) and a wash (background).
        present: { DEFAULT: token('present'), wash: token('present-wash') },
        late: { DEFAULT: token('late'), wash: token('late-wash') },
        absent: { DEFAULT: token('absent'), wash: token('absent-wash') },
        leave: { DEFAULT: token('leave'), wash: token('leave-wash') },
        excused: { DEFAULT: token('excused'), wash: token('excused-wash') },
        holiday: { DEFAULT: token('holiday'), wash: token('holiday-wash') },
        dayoff: { DEFAULT: token('dayoff'), wash: token('dayoff-wash') },
      },
      borderRadius: { sm: '3px', DEFAULT: '5px', md: '6px', lg: '8px' },
      boxShadow: {
        // Soft, offset, blurred depth: used only on floating layers (menus, dialogs).
        float: '0 8px 24px -6px oklch(0.25 0.03 255 / 0.18), 0 2px 6px -2px oklch(0.25 0.03 255 / 0.12)',
      },
    },
  },
  plugins: [],
}
export default config
