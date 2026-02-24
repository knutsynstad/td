import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/client/**/*.test.ts',
      'tests/server/**/*.test.ts',
      'src/server/**/*.test.ts',
      'src/shared/**/*.test.ts',
    ],
    coverage: {
      enabled: false,
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
    },
  },
});
