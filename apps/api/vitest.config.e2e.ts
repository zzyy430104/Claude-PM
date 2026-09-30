import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      MAIL_TRANSPORT: 'memory',
      // 测试里反复登录，放宽限流；限流本身由专门的用例覆盖
      RATE_LIMIT_LOGIN_PER_ACCOUNT: '1000',
      RATE_LIMIT_LOGIN_PER_IP: '100000',
      RATE_LIMIT_SIGNUP_PER_IP: '100000',
      STORAGE_DIR: join(tmpdir(), 'claude-pm-test-storage'),
      PLATFORM_ADMIN_EMAIL: 'root@platform.test',
      PLATFORM_ADMIN_PASSWORD: 'platform-pass-1',
    },
  },
});
