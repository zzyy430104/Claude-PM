// 系统内对话框：确认框和输入框（可拖动、Esc 取消、删除类操作红色按钮），代替浏览器自带的 confirm / prompt
process.env.PM_INAPP_DIALOGS = '1';
const { launch, step, loginAs, openProject, tab } = await import('./lib.mjs');
const { seedTenant, call } = await import('./seed.mjs');

const u = await seedTenant('dlg-' + Date.now().toString(36));
const code = 'DLG-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '对话框测试', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: false,
    quality: { standards: [], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {});

const { b, p, errors } = await launch();
let nativeDialogs = 0;
p.on('dialog', (d) => { nativeDialogs++; d.dismiss(); });

await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, 'WBS');
await p.waitForSelector('table.wbs tbody tr');
const row = 'tr:has-text("项目启动会")';

// 1. 确认框：取消不删除；Esc 也是取消
await p.click(`${row} button:has-text("删除")`);
await p.waitForSelector('[data-dialog] .msg:has-text("确定删除工作包")');
if (!(await p.$('[data-dialog] button.danger:has-text("确定")'))) throw new Error('删除类确认应为红色按钮');
await p.click('[data-dialog] button:has-text("取消")');
await p.waitForSelector('[data-dialog]', { state: 'detached' });
await p.click(`${row} button:has-text("删除")`);
await p.waitForSelector('[data-dialog] .win');
await p.keyboard.press('Escape');
await p.waitForSelector('[data-dialog]', { state: 'detached' });
await p.waitForSelector(row);
step('确认框：取消或 Esc 不执行，删除类操作的确定按钮为红色');

// 2. 拖动标题栏移动位置
await p.click(`${row} button:has-text("删除")`);
const head = await p.waitForSelector('[data-dialog] header');
const before = await head.boundingBox();
await p.mouse.move(before.x + 40, before.y + 10); await p.mouse.down();
await p.mouse.move(before.x - 160, before.y + 120, { steps: 8 }); await p.mouse.up();
const after = await (await p.$('[data-dialog] header')).boundingBox();
if (Math.abs(after.x - before.x) < 100 || Math.abs(after.y - before.y) < 80) throw new Error('对话框没有被拖动');
step('对话框按住标题栏可以拖动');

// 3. 确定后执行
await p.click('[data-dialog] button:has-text("确定")');
await p.waitForSelector(row, { state: 'detached' });
step('确认后删除工作包');

// 4. 输入框：另存为 WBS 模板要填名称，回车确定
await p.click('button:has-text("另存为 WBS 模板")');
await p.waitForSelector('[data-dialog] textarea');
await p.keyboard.type('转向架标准 WBS');
await p.keyboard.press('Enter');
await p.waitForSelector('[data-dialog]', { state: 'detached' });
await p.waitForFunction(() => [...document.querySelectorAll('select[aria-label="从 WBS 模板添加"] option')].some((o) => o.textContent.includes('转向架标准 WBS')));
step('输入框：填写名称回车确定，另存为 WBS 模板');

if (nativeDialogs) throw new Error(`出现了 ${nativeDialogs} 个浏览器自带对话框`);
if (errors.length) throw new Error(errors.join('\n'));
await b.close();
console.log('dialogs: all passed');
