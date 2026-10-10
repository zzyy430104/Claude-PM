import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { validateTemplate } from './planning.service.js';
import { DEFAULT_TEMPLATES, generatePlan, isGroup } from './plan-templates.js';
import { EMPTY_REQUIREMENTS, requirementProblems, type Requirements } from './requirements.js';

const req = (q: Partial<Requirements['quality']> = {}, extra: Partial<Requirements> = {}): Requirements =>
  ({ ...EMPTY_REQUIREMENTS, ...extra, quality: { ...EMPTY_REQUIREMENTS.quality, ...q } });

describe('A/B/C 计划模板', () => {
  it('三套默认模板本身是合法的（编号唯一、前置存在、无循环）', () => {
    for (const t of ['A', 'B', 'C'] as const) expect(() => validateTemplate(DEFAULT_TEMPLATES[t])).not.toThrow();
  });

  it('B 类做 FAI 但不要客户见证、没有长周期物料：去掉 3.3 和 5.2，依赖接到它们的前置', () => {
    const p = generatePlan('B', DEFAULT_TEMPLATES.B, req({ fai: true }));
    expect(p.phases).toEqual(['项目策划', '技术准备', 'FAI 首件鉴定', '量产', '交付', '项目总结']);
    expect(p.removed.map((r) => r.code)).toEqual(['3.3', '5.2']);
    expect(p.items.find((i) => i.code === '3.4')!.predecessors).toEqual(['3.2']);
    expect(p.items.find((i) => i.code === '5.3')!).toMatchObject({ purchase: true, phase: null });
  });

  it('B 类不做 FAI：整个 FAI 阶段去掉，量产准备评审改接到技术准备评审和首件物料', () => {
    const p = generatePlan('B', DEFAULT_TEMPLATES.B, req({ fai: false, faiReason: '沿用已验证工艺' }, { longLead: true }));
    expect(p.phases).not.toContain('FAI 首件鉴定');
    expect(p.items.some((i) => i.code.startsWith('3.'))).toBe(false);
    expect(p.items.find((i) => i.code === '4.1')!.predecessors.sort()).toEqual(['2.6', '5.3', '5.5']);
    expect(p.items.some((i) => i.code === '5.2')).toBe(true);
    expect(p.removed[0].reason).toContain('沿用已验证工艺');
  });

  it('A 类：FAI 必做；勾选的客户图纸审批、RAMS 保留', () => {
    const p = generatePlan('A', DEFAULT_TEMPLATES.A, req({ fai: false, drawingApproval: true, rams: true }));
    expect(p.phases).toContain('FAI 首件鉴定');
    expect(p.items.map((i) => i.code)).toEqual(expect.arrayContaining(['2.5', '2.7', '4.2']));
    expect(DEFAULT_TEMPLATES.A.filter((r) => !isGroup(r))).toHaveLength(39);
  });

  it('C 类：生产、入库，没有售后交接', () => {
    const p = generatePlan('C', DEFAULT_TEMPLATES.C, req({ fai: false, faiReason: '工艺未变更' }));
    expect(p.phases).toEqual(['项目策划', '技术准备', '生产', '入库', '项目总结']);
    expect(p.items.some((i) => i.name.includes('售后'))).toBe(false);
  });

  it('模板校验：前置不存在、循环都会被拒绝', () => {
    const bad = [{ code: '1', name: 'x', group: true as const, phase: 'x' }, { code: '1.1', name: 'a', durationDays: 1, predecessors: ['1.2'], role: '', deliverable: '' }, { code: '1.2', name: 'b', durationDays: 1, predecessors: ['1.1'], role: '', deliverable: '' }];
    expect(() => validateTemplate(bad)).toThrow(BadRequestException);
    expect(() => validateTemplate([...bad.slice(0, 2), { ...bad[2], predecessors: ['9.9'] }])).toThrow(/9\.9/);
  });

  it('立项完整性：B 类缺客户、交期、产品、成本、不做 FAI 的理由', () => {
    const p = requirementProblems({ type: 'B', name: 'x', projectCode: '', customer: '', proposedPmId: null, startDate: null }, req({ fai: false }));
    expect(p).toEqual(['项目编号', '项目经理', '计划开始日期', '客户', '全部交付日期', '产品交付物', '成本上限', '不做 FAI 的理由']);
  });
});
