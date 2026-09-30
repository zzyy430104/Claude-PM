import { launch, step, loginAs, openProject, tab } from './lib.mjs';
import { seedTenant, seedProject } from './seed.mjs';
import { writeFileSync } from 'node:fs';
const u = await seedTenant('e-' + Date.now().toString(36));
const proj = await seedProject(u);
const { b, p, errors } = await launch();
p.on('dialog', d => d.accept(d.message().includes('审批') ? '同意报价' : '2026-06-01'));

await loginAs(p, u.pm); await openProject(p, proj.code);
await tab(p, '文档');
await p.setInputFiles('input[type=file]', { name: '设计说明.txt', mimeType: 'text/plain', buffer: Buffer.from('转向架设计说明 v1') });
await p.fill('input[formcontrolname=name]', '转向架设计说明');
await p.click('button:has-text("上传")');
await p.waitForSelector('td:has-text("转向架设计说明")');
await p.waitForSelector('td:has-text("设计说明.txt")'); step('上传文档（中文文件名）');
await p.setInputFiles('input[type=file]', { name: '设计说明.txt', mimeType: 'text/plain', buffer: Buffer.from('转向架设计说明 v2') });
await p.fill('input[formcontrolname=name]', '转向架设计说明');
await p.click('button:has-text("上传")');
await p.waitForSelector('td:has-text("v2")'); step('同名再传生成 v2');
await p.click('button:has-text("历史版本")');
await p.waitForSelector('td:has-text("v1")'); step('可查看历史版本');
// 沙箱是 POSIX 区域设置，Chromium 会把非 ASCII 的下载文件名丢掉，所以直接检查应用给 <a download> 设置的文件名
await p.evaluate(() => { window.__dl = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = this.download; return orig.call(this); }; });
await p.click('button:has-text("下载")');
await p.waitForFunction(() => window.__dl);
const dlName = await p.evaluate(() => window.__dl);
if (dlName !== '设计说明.txt') throw new Error('下载文件名不对: ' + dlName);
step('下载文件名正确（' + dlName + '）');

await tab(p, '配置管理');
await p.fill('input[formcontrolname=code]', 'BOGIE'); await p.fill('input[formcontrolname=name]', '转向架');
await p.click('button:has-text("添加配置项")');
await p.waitForSelector('td:has-text("BOGIE")');
await p.fill('input[formcontrolname=name] >> nth=1', '基线一');
await p.click('button:has-text("建立基线")');
await p.waitForSelector('text=产品分解结构必须分解到最低可更换单元'); step('PBS 未分解到 LLRU 不能建基线');

await tab(p, '经验教训与关闭');
await p.fill('input[formcontrolname=title]', '外协件检验前置');
await p.fill('input[formcontrolname=description]', '到货后才发现超差');
await p.fill('input[formcontrolname=recommendation]', '合同约定发货前见证');
await p.click('button:has-text("登记")');
await p.waitForSelector('.box:has-text("外协件检验前置")'); step('登记经验教训');
await p.click('button:has-text("关闭项目")');
await p.waitForSelector('text=暂不能关闭项目'); step('阶段未关闭时项目不能关闭');

await p.click('a:has-text("经验教训库")');
await p.waitForSelector('.box:has-text("外协件检验前置")'); step('企业知识库可检索');

// 投标流程
await p.click('a:has-text("投标")');
await p.fill('input[formcontrolname=code]', 'T-01'); await p.fill('input[formcontrolname=title]', '动车组转向架投标'); await p.fill('input[formcontrolname=customer]', '某某集团');
await p.click('button:has-text("新建投标")');
await p.waitForSelector('.box:has-text("T-01")');
await p.click('.box button:has-text("提交审批")');
await p.waitForSelector('text=需求管理');  step('投标内容不全不能提交');
await p.waitForTimeout(700);
await p.click('.box button:has-text("编辑内容")');
await p.waitForSelector('.box textarea');
for (const [i, v] of ['200km/h 转向架', '原材料涨价', '参考 HSR-001', '设计文件与样机', '设计 6 人'].entries()) await p.locator('.box textarea').nth(i).fill(v);
await p.fill('input[formcontrolname=riskExposure]', '500000'); await p.fill('input[formcontrolname=estimatedCost]', '8000000'); await p.fill('input[formcontrolname=offerPrice]', '9500000');
await p.click('.box button:has-text("保存")');
await p.click('.box button:has-text("提交审批")');
await p.waitForSelector('.box:has-text("待审批")'); step('提交审批');
await loginAs(p, u.top); await p.click('a:has-text("投标")');
await p.click('.box button:has-text("批准报价")');
await p.waitForSelector('.box:has-text("已批准")'); step('最高管理层批准报价');
await loginAs(p, u.pm); await p.click('a:has-text("投标")');
await p.click('.box button:has-text("标记中标")');
await p.waitForSelector('.box:has-text("已中标")');
await p.click('.box button:has-text("转为项目")');
await p.waitForSelector('h1:has-text("动车组转向架投标")'); step('中标转为项目');
await p.waitForSelector('dd:has-text("8,000,000")'); step('项目预算取自投标成本测算');
console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
