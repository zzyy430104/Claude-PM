import { execSync } from 'node:child_process';

/** 对测试库执行迁移，保证库结构与迁移文件一致 */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://pm:pm@localhost:5432/claude_pm_test',
    },
  });
}
