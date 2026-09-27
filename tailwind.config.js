/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './swatch.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          interactive: 'var(--surface-interactive)',
        },
        border: {
          muted: 'var(--border-muted)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        primary: 'var(--primary)',
        secondary: 'var(--secondary)',
        tertiary: 'var(--tertiary)',
        error: 'var(--error)',
        'error-text': 'var(--error-text)',
        'text-high': 'var(--text-high)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'text-subtle': 'var(--text-subtle)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        rounded: 'var(--radius-base)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        level2: 'var(--elevation-2)',
        level3: 'var(--elevation-3)',
        inner: 'var(--elevation-inner)',
        glow: 'var(--elevation-glow)',
      },
    },
  },
  plugins: [],
}
