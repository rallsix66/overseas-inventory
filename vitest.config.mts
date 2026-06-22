import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      'server-only': new URL('./src/features/sync/__mocks__/server-only.ts', import.meta.url).pathname,
    },
  },
})
