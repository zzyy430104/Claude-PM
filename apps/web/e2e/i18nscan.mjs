import { launch, loginAs, openProject, tab } from './lib.mjs';
import { seedTenant, seedProject, call } from './seed.mjs';
const u = await seedTenant('i-' + Date.now().toString(36));
const proj = await seedProject(u);
await call('POST', `/projects/${proj.id}/risks`, u.pm.access, { kind: 'RISK', title: 'Supplier delay', probability: 5, impact: 4, exposureAmount: 200000, responseCost: 30000, costBenefitAnalysis: 'Order early' });
const { b, p } = await launch();
await loginAs(p, u.pm);
await p.evaluate(() => localStorage.setItem('pm.lang', 'en'));
await p.reload(); await p.waitForSelector('mat-toolbar'); await p.waitForTimeout(600);

const left = new Map();
async function scan(label) {
  await p.waitForTimeout(500);
  const texts = await p.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { if (/[一-鿿]/.test(n.data) && !['SCRIPT','STYLE'].includes(n.parentElement?.tagName)) out.push(n.data.trim()); }
    for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) for (const a of ['placeholder','aria-label','title']) { const v = el.getAttribute(a); if (v && /[一-鿿]/.test(v)) out.push(`@${a}=${v}`); }
    return out;
  });
  for (const t of texts) left.set(t, label);
}
const userData = ['李经理', '评审演示项目', '演示企业', '张管理', '赵质量', '王成员', '钱总', '设计', '制造', '交付'];
await scan('home');
await p.click('a:has-text("Projects")'); await scan('projects');
await p.click(`a:has-text("${proj.code}")`); await p.waitForSelector('.gtabs');
for (let g = 0; g < await p.locator('.gtabs [role=tab]').count(); g++) {
  await p.locator('.gtabs [role=tab]').nth(g).click(); await p.waitForTimeout(400);
  const subs = await p.locator('.stabs [role=tab]').count();
  if (!subs) { await scan('group:' + g); continue; }
  for (let s = 0; s < subs; s++) { await p.locator('.stabs [role=tab]').nth(s).click(); await p.waitForTimeout(500); await scan(`tab:${g}.${s}`); }
}
await p.click('mat-sidenav a:has-text("Lesson")'); await scan('lessons');
console.log('剩余中文（去掉用户数据）：');
for (const [t, where] of left) if (!userData.some((d) => t === d || t.includes(d) && t.length <= d.length + 6)) console.log(`  [${where}] ${t}`);
await b.close();
