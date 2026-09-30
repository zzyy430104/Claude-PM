import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://pm:pm@localhost:5432/claude_pm_test',
      JWT_SECRET: 'test-secret',
      ALLOW_TENANT_SIGNUP: 'true',
      PLATFORM_ADMIN_EMAIL: 'root@platform.test',
      PLATFORM_ADMIN_PASSWORD: 'platform-pass-1',
    },
  },
});
