// 第 5 步：AI 辅助（需在 API 启动时设置 AI_TRANSPORT=mock，不调用外部接口）
// 设置与测试连接、合同起草项目要求、一句话登记、会议纪要整理、不符合项原因分析、计划调整建议、周报摘要、项目总结、使用记录
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('ai-' + Date.now().toString(36));
const code = 'AI-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: true, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });
const start = new Date(Date.now() - 86_400_000); start.setHours(9, 30, 0, 0);
const mt = await call('POST', `/projects/${pid}/meetings`, u.pm.access, { title: '项目周例会', type: 'REGULAR', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), attendees: [{ userId: u.member.id }] });

const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept());

// 1. 企业设置 → AI 辅助
await loginAs(p, u.admin);
await p.goto(`${WEB}/settings`);
await p.waitForSelector('app-ai-settings h3:text-is("AI 辅助")');
await p.check('input[aria-label="启用 AI 辅助"]');
await p.fill('input[aria-label="API 密钥"]', 'sk-test-0000000000abcd');
await p.click('button:has-text("保存 AI 设置")');
await p.waitForSelector('app-ai-settings .ok:text-is("已保存")');
if (await p.inputValue('input[aria-label="API 密钥"]') !== '') throw new Error('密钥不应回显');
await p.waitForSelector('input[aria-label="API 密钥"][placeholder*="sk-****abcd"]');
await p.click('button:has-text("测试连接")');
await p.waitForSelector('app-ai-settings :text("连接成功")');
step('企业设置：启用 AI、密钥只显示掩码、测试连接列出可用模型');

// 2. 立项：从合同起草项目要求
await loginAs(p, u.pm);
await p.goto(`${WEB}/initiations/new`);
await p.fill('input[aria-label=项目名称]', '动车组座椅骨架');
await p.setInputFiles('input[aria-label=合同文件]', { name: 'contract.txt', mimeType: 'text/plain', buffer: Buffer.from('合同第 3.1 条：2027-01-15 前全部交付。') });
await p.click('[data-ai=contract] button:has-text("读取并起草")');
await p.waitForSelector('[data-ai=contract] tr[data-row="全部交付日期"]:has-text("合同第 3.1 条")');
await p.uncheck('[data-ai=contract] input[aria-label="采用 初步风险"]');
await p.click('[data-ai=contract] button:has-text("采用选中的")');
await p.waitForFunction(() => document.querySelector('input[aria-label=客户]')?.value === '华南城轨');
if (await p.inputValue('input[aria-label=全部交付日期]') !== '2027-01-15') throw new Error('交付日期未写入');
await p.click('button:has-text("保存草稿")');
await p.waitForURL(/\/initiations\/[0-9a-f-]{36}/);
await p.waitForSelector('app-ai-mark :text("AI 起草，李经理 确认")');
step('立项：上传合同，AI 列出条款和出处，勾选采用后写入表单；保存后标记“AI 起草，李经理 确认”');

// 3. 一句话登记
await openProject(p, code);
await p.click('button.aiq');
await p.fill('input[aria-label=一句话描述]', '二车间焊缝外观检验发现 3 件咬边不合格，需返工');
await p.click('[data-ai=quick] button:has-text("AI 起草")');
await p.waitForSelector('select[aria-label=登记类型]');
if (await p.inputValue('select[aria-label=登记类型]') !== 'NONCONFORMITY') throw new Error('应识别为不符合项');
await p.click('[data-ai=quick] button:has-text("确认登记")');
await p.waitForSelector('.stabs [role=tab][aria-selected=true]:text-is("不符合项")');
await p.waitForSelector('.box:has-text("咬边") app-ai-mark :text("AI 起草")');
step('一句话登记：AI 判断为不符合项并起草，确认后登记');

// 4. 不符合项原因分析
await p.click('.box:has-text("咬边") button:has-text("起草原因分析和措施")');
await p.waitForFunction(() => [...document.querySelectorAll('input[formcontrolname=rootCause]')].some((i) => i.value.includes('→')));
step('不符合项：AI 起草遏制措施、根本原因和纠正 / 预防措施');

// 5. 会议纪要
await tab(p, '沟通');
await p.click('[data-meeting="项目周例会"]');
await p.click('[role=tab]:text-is("纪要")');
await p.fill('textarea[aria-label=会议记录原文]', '王成员说 PFMEA 完成八成，铸件供应商产能紧张，决定开发第二供应商。');
await p.click('[data-ai=minutes] button:has-text("AI 整理")');
await p.waitForFunction(() => document.querySelector('textarea[aria-label=讨论要点]')?.value.includes('PFMEA'));
await p.click('button:has-text("发布纪要")');
await p.waitForSelector('[data-detail] app-ai-mark :text("AI 起草，李经理 确认")');
step('会议：粘贴会议记录，AI 整理要点、决定和行动项，发布后标记');

// 6. 计划调整建议
await tab(p, 'WBS');
await p.click('[data-ai=plan] button:has-text("生成建议")');
await p.waitForSelector('[data-ai=plan] tr[data-sug="客户驻厂见证 FAI 准备"]');
await p.click('[data-ai=plan] tr[data-sug="客户驻厂见证 FAI 准备"] button:has-text("采纳")');
await p.waitForSelector('[data-ai=plan] tr[data-sug="客户驻厂见证 FAI 准备"] .pill:text-is("已采纳")');
await p.waitForSelector('text=客户驻厂见证 FAI 准备');
step('WBS：AI 对照项目要求给出计划调整建议，采纳后新增工作包');

// 7. 周报摘要
await p.goto(`${WEB}/projects/${pid}/report`);
await p.click('button:has-text("起草本周摘要")');
await p.waitForSelector('textarea[aria-label=本周摘要草稿]');
await p.click('[data-ai=report] button:has-text("采用")');
await p.waitForSelector('[data-summary]:has-text("本周进度正常")');
step('周报：AI 起草本周摘要，采用后显示在周报里');

// 8. 项目总结
await p.goto(`${WEB}/projects/${pid}?g=close&s=closure`);
await p.click('[data-ai=summary] button:has-text("起草项目总结和经验教训")');
await p.waitForSelector('[data-ai=summary] [data-summary]');
await p.click('[data-ai-lesson="长周期铸件提前下单"] button:has-text("采用为经验教训")');
await p.waitForSelector('.box:has-text("长周期铸件提前下单") app-ai-mark :text("AI 起草")');
step('项目总结：AI 起草总结和经验教训，逐条采用');

// 9. 使用记录
await loginAs(p, u.admin);
await p.goto(`${WEB}/settings`);
await p.waitForSelector('app-ai-settings td:has-text("一句话登记")');
await p.waitForSelector('app-ai-settings td:text-is("已采纳")');
step('企业设置：AI 使用记录（谁、时间、场景、是否采纳）');

if (errors.length) throw new Error(errors.join('\n'));
await b.close();
console.log('ai: all passed');
