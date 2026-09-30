// 依次运行所有浏览器测试。需要先启动 API（3000）和前端（4200），见 README.md
import { spawnSync } from 'node:child_process';
const scripts = ['batchA', 'batchB', 'batchC', 'batchD', 'batchE', 'batchF', 'password', 'integration', 'compare', 'completion', 'i18nscan'];
let failed = 0;
for (const s of scripts) {
  console.log(`\n===== ${s} =====`);
  const r = spawnSync('node', [`${import.meta.dirname}/${s}.mjs`], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) { failed++; console.log(`✘ ${s} 失败`); }
}
console.log(failed ? `\n${failed} 个脚本失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
