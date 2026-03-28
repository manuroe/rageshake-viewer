import { defineConfig, mergeConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import codspeedPlugin from '@codspeed/vitest-plugin'

// https://vite.dev/config/
export default mergeConfig(
  defineConfig({
    plugins: [react()],
    base: process.env.VITE_BASE || '/rageshake-viewer/',
  }),
  defineVitestConfig({
    plugins: [codspeedPlugin()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      globals: true,
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.perf.test.ts'],
      benchmark: {
        include: ['**/*.perf.test.ts'],
      },
      coverage: {
        provider: 'istanbul',
        all: true,
        include: ['src/**/*.{ts,tsx}'],
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage',
        exclude: [
          'src/test/**',
          '**/__tests__/**',
          '**/*.test.ts',
          '**/*.test.tsx',
          'scripts/**',
          'vite.config.ts',
          'eslint.config.js',
          'src/main.tsx', // bootstrap entry point — no testable logic
        ],
        thresholds: {
          // Per-folder floors based on current coverage — do not regress below these.
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/utils/**': { statements: 92, branches: 87, functions: 94, lines: 93 },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/stores/**': { statements: 90, branches: 69, functions: 100, lines: 92 },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/hooks/**': { statements: 98, branches: 95, functions: 100, lines: 98 },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/components/**': { statements: 95, branches: 89, functions: 92, lines: 97 },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/views/**': { statements: 93, branches: 83, functions: 94, lines: 95 },
        },
      },
    },
  })
);
