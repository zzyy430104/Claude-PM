// 改进方案第三步“补齐”：工作日历、里程碑、资源负荷、Excel 导出导入、WBS 模板、可选参与者、SWOT、偏离通报、风险增强、干系人、周报
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, seedProject, call } from './seed.mjs';
import ExcelJS from '../../api/node_modules/exceljs/dist/es5/index.js';
const slug = 'cm-' + Date.now().toString(36);
const u = await seedTenant(slug);
const proj = await seedProject(u, { startDate: '2026-09-28', endDate: '2026-12-31' }, false);
const pid = proj.id;
const { b, p, errors } = await launch();

// 工作日历
await loginAs(p, u.admin);
await p.click('a:has-text("企业设置")');
await p.fill('textarea[formcontrolname=holidays]', '2026-10-01\n2026-10-02');
await p.click('button:has-text("保存")');
await p.waitForSelector('text=已保存'); step('企业设置节假日');

// 里程碑与工期按工作日
await loginAs(p, u.pm); await openProject(p, proj.code);
await tab(p, 'WBS');
await p.fill('input[formcontrolname=code]', 'A');
await p.fill('input[formcontrolname=name]', '方案设计');
await p.fill('input[formcontrolname=durationDays]', '5');
await p.click('mat-select[formcontrolname=ownerId]'); await p.click('mat-option:has-text("王成员")');
await p.click('button:has-text("添加工作包")');
await p.waitForSelector('tr:has-text("方案设计"):has-text("2026-10-06")'); step('工期按工作日计算，跳过周末和节假日');
await p.fill('input[formcontrolname=code]', 'M1');
await p.fill('input[formcontrolname=name]', '设计评审通过');
await p.click('mat-checkbox:has-text("里程碑")');
await p.click('button:has-text("添加工作包")');
await p.waitForSelector('tr:has-text("◆") :text("设计评审通过")'); step('新增里程碑');

// Excel 导入
const dir = mkdtempSync(join(tmpdir(), 'xl-'));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('WBS');
ws.addRow(['编号', '名称', '工期（工作日）', '负责人', '前置工作包']);
ws.addRow(['B', '详细设计', 8, '王成员', 'A']);
ws.addRow(['C', '图纸审核', 3, '', 'B']);
const good = join(dir, 'wbs.xlsx');
writeFileSync(good, Buffer.from(await wb.xlsx.writeBuffer()));
await p.setInputFiles('input[type=file][accept=".xlsx"]', good);
await p.waitForSelector('text=导入完成：新增 2 个、更新 0 个工作包，新增 2 个依赖。'); step('Excel 导入工作包和依赖');
const bad = new ExcelJS.Workbook();
const bs = bad.addWorksheet('WBS');
bs.addRow(['编号', '名称', '工期（工作日）', '上级编号']);
bs.addRow(['D', '坏行', 3, 'ZZZ']);
const badFile = join(dir, 'bad.xlsx');
writeFileSync(badFile, Buffer.from(await bad.xlsx.writeBuffer()));
await p.setInputFiles('input[type=file][accept=".xlsx"]', badFile);
await p.waitForSelector('li:has-text("上级编号“ZZZ”不存在")'); step('Excel 有错误时逐行列出，不写入');
const [download] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("导出 Excel")')]);
if (!(await download.suggestedFilename()).endsWith('.xlsx')) throw new Error('导出文件名不对');
step('导出 Excel');

// WBS 模板
p.once('dialog', (d) => d.accept('转向架设计 WBS'));
await p.click('button:has-text("另存为 WBS 模板")');
await p.waitForFunction(() => [...document.querySelectorAll('select.tpl option')].some((o) => o.textContent.includes('转向架设计 WBS')));
step('另存为 WBS 模板');

// 风险增强
await tab(p, '风险与机会');
await p.click('mat-select[formcontrolname=kind]'); await p.click('mat-option:has-text("机会")');
await p.fill('input[formcontrolname=title]', '国产轴承替代');
await p.fill('input[formcontrolname=costBenefitAnalysis]', '节省成本明显');
await p.fill('input[formcontrolname=maturityLevel]', 'TRL 7');
await p.fill('input[formcontrolname=functionalReviewers]', '采购部张经理');
await p.fill('input[formcontrolname=budgetRecovery]', '30000');
await p.click('button:has-text("登记")');
await p.waitForSelector('td:has-text("成熟度：TRL 7"):has-text("可弥补预算：30,000")'); step('风险与机会：成熟度、职能评审、可弥补预算');

// SWOT
await tab(p, '项目评审');
await p.fill('input[formcontrolname=participants]', '客户技术部、某铸造厂');
await p.fill('textarea[formcontrolname=threats]', '原材料涨价');
await p.click('button:has-text("记录 SWOT 评审")');
await p.waitForSelector('.t:has-text("原材料涨价")'); step('SWOT 评审');

// 偏离通报与干系人
await tab(p, '沟通与培训');
await p.fill('input[formcontrolname=audience]', '客户项目经理');
await p.fill('textarea[formcontrolname=impact]', '设计延期一周');
await p.fill('textarea[formcontrolname=countermeasures]', '增加设计人员');
await p.click('button:has-text("记录偏离通报")');
await p.waitForSelector('td:has-text("设计延期一周")'); step('偏离通报');
await p.fill('app-project-stakeholders input[formcontrolname=name]', '客户项目经理');
await p.fill('app-project-stakeholders input[formcontrolname=organization]', '某地铁公司');
await p.click('button:has-text("添加干系人")');
await p.waitForSelector('td:has-text("某地铁公司")'); step('干系人登记册');

// 周报
await tab(p, '概览');
await p.click('a:has-text("项目周报")');
await p.waitForSelector('h1:has-text("项目周报")');
await p.waitForSelector('li:has-text("向客户项目经理通报进度偏离")'); step('项目周报（含偏离通报）');

// 资源负荷
await p.click('mat-sidenav a:has-text("资源负荷")');
await p.fill('input[type=date]', '2026-09-28');
await p.click('button:has-text("查询")');
await p.waitForSelector('tr:has-text("王成员")'); step('资源负荷按人按周显示');

console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
