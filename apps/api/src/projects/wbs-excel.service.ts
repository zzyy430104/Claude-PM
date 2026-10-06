import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { WpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import { CycleError, topoOrder } from './schedule.js';
import { WbsService } from './wbs.service.js';

/** 导出与导入共用的列；导入时按表头名称识别列，顺序不限 */
const COLUMNS = [
  { key: 'code', header: '编号', width: 10 },
  { key: 'name', header: '名称', width: 28 },
  { key: 'parent', header: '上级编号', width: 10 },
  { key: 'milestone', header: '里程碑', width: 8 },
  { key: 'duration', header: '工期（工作日）', width: 12 },
  { key: 'start', header: '计划开始', width: 12 },
  { key: 'end', header: '计划结束', width: 12 },
  { key: 'owner', header: '负责人', width: 12 },
  { key: 'phase', header: '所属阶段', width: 14 },
  { key: 'deliverable', header: '产出交付物', width: 18 },
  { key: 'account', header: '成本科目', width: 10 },
  { key: 'budget', header: '预算', width: 12 },
  { key: 'resource', header: '人天', width: 8 },
  { key: 'provider', header: '外部供方', width: 16 },
  { key: 'longLead', header: '长周期', width: 8 },
  { key: 'preds', header: '前置工作包', width: 14 },
  { key: 'pct', header: '完成%', width: 8 },
  { key: 'status', header: '状态', width: 8 },
  { key: 'critical', header: '关键路径', width: 8 },
] as const;
type Key = (typeof COLUMNS)[number]['key'];

const STATUS: Record<WpStatus, string> = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', DONE: '已完成', VERIFIED: '已验证' };
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const yes = (v: string) => ['是', 'y', 'yes', 'true', '1', '√', '✓'].includes(v.trim().toLowerCase());

interface Row { line: number; v: Partial<Record<Key, string>> }

/**
 * WBS 与 Excel（8.1.3.4 f）：导出进度表作为主生产计划的输入；从 Excel 批量导入工作包和依赖。
 * 导入按编号匹配：新编号新增，已有编号更新。先校验整张表，有任何错误就一条也不写入。
 */
@Injectable()
export class WbsExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
    private readonly wbs: WbsService,
  ) {}

  async export(actor: AuthUser, projectId: string, templateOnly = false) {
    const ctx = await this.access.load(actor, projectId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Claude-PM';
    const ws = wb.addWorksheet('WBS');
    ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    if (!templateOnly) {
      const where = { projectId, tenantId: ctx.tenantId };
      const [sched, phases, deliverables, accounts, members, deps] = await Promise.all([
        this.wbs.get(actor, projectId),
        this.prisma.phase.findMany({ where }),
        this.prisma.deliverable.findMany({ where }),
        this.prisma.costAccount.findMany({ where }),
        this.prisma.projectMember.findMany({ where }),
        this.prisma.wpDependency.findMany({ where }),
      ]);
      const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true } });
      const byId = new Map(sched.items.map((w) => [w.id, w]));
      const name = <T extends { id: string }>(xs: T[], id: string | null, f: (x: T) => string) => (id ? f(xs.find((x) => x.id === id) ?? ({} as T)) ?? '' : '');
      const items = [...sched.items].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      for (const w of items) {
        ws.addRow({
          code: w.code, name: w.name, parent: w.parentId ? byId.get(w.parentId)?.code ?? '' : '',
          milestone: w.isMilestone ? '是' : '', duration: w.isLeaf ? w.durationDays : '',
          start: w.scheduledStart, end: w.scheduledEnd,
          owner: name(users, w.ownerId, (u) => u.name), phase: name(phases, w.phaseId, (p) => p.name),
          deliverable: name(deliverables, w.deliverableId, (d) => d.name), account: name(accounts, w.costAccountId, (a) => a.code),
          budget: w.budget !== null ? Number(w.budget) : '', resource: w.resourceDays !== null ? Number(w.resourceDays) : '',
          provider: w.externalProvider ?? '', longLead: w.longLead ? '是' : '',
          preds: deps.filter((d) => d.successorId === w.id).map((d) => byId.get(d.predecessorId)?.code).filter(Boolean).join(','),
          pct: w.isLeaf ? w.percentComplete : '', status: STATUS[w.status], critical: w.critical ? '是' : '',
        });
      }
    } else {
      ws.addRow({ code: '1', name: '设计', duration: '' });
      ws.addRow({ code: '1.1', name: '方案设计', parent: '1', duration: 10, owner: '（项目成员姓名或邮箱）', phase: '（阶段名称）' });
      ws.addRow({ code: '1.2', name: '详细设计', parent: '1', duration: 15, preds: '1.1' });
      ws.addRow({ code: 'M1', name: '设计评审通过', milestone: '是', preds: '1.2' });
      const help = wb.addWorksheet('填写说明');
      help.columns = [{ header: '列', key: 'c', width: 16 }, { header: '说明', key: 'd', width: 80 }];
      for (const [c, d] of [
        ['编号', '必填，项目内唯一，如 1、1.1、M1。已有编号会被更新，新编号会被新增。'],
        ['名称', '必填。'], ['上级编号', '可选，填上级工作包的编号；上级可以是已有的，也可以在本表里。'],
        ['里程碑', '填“是”表示里程碑（工期为 0）。'], ['工期（工作日）', '末级工作包必填，按企业工作日历计算日期。'],
        ['负责人', '可选，项目成员的姓名或邮箱。'], ['所属阶段 / 产出交付物', '可选，填名称，须已在项目里存在。'],
        ['成本科目', '可选，填科目编号。'], ['前置工作包', '可选，多个编号用逗号分隔，只能在末级工作包之间建立。'],
        ['计划开始、计划结束、完成%、状态、关键路径', '导出时由系统计算，导入时忽略。'],
      ]) help.addRow({ c, d });
      help.getRow(1).font = { bold: true };
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer: buf, fileName: templateOnly ? 'wbs-import-template.xlsx' : `wbs-${ctx.project.code}.xlsx` };
  }

  async import(actor: AuthUser, projectId: string, file: Buffer, changeRequestId?: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'WBS');
    this.access.requireOpen(ctx);

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Not a readable .xlsx file', errors: ['文件不是有效的 Excel（.xlsx）文件'] });
    }
    const ws = wb.getWorksheet('WBS') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Empty workbook', errors: ['文件里没有工作表'] });
    const text = (c: ExcelJS.Cell) => {
      const v = c.value as unknown;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result ?? '').trim();
      if (typeof v === 'object' && v && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('').trim();
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();
    };
    const colOf = new Map<Key, number>();
    ws.getRow(1).eachCell((cell, col) => {
      const h = text(cell);
      const c = COLUMNS.find((x) => x.header === h || x.header.startsWith(h + '（'));
      if (c) colOf.set(c.key, col);
    });
    const errors: string[] = [];
    if (!colOf.has('code') || !colOf.has('name')) errors.push('表头缺少“编号”或“名称”列（第一行应为表头，可先下载导入模板）');
    const rows: Row[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const v: Partial<Record<Key, string>> = {};
      for (const [k, col] of colOf) v[k] = text(row.getCell(col));
      if (Object.values(v).some((x) => x)) rows.push({ line: n, v });
    });
    if (!rows.length && !errors.length) errors.push('表里没有数据行');
    if (errors.length) throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Import failed', errors });

    // 引用数据
    const where = { projectId, tenantId: ctx.tenantId };
    const [existing, phases, deliverables, accounts, members, deps] = await Promise.all([
      this.prisma.workPackage.findMany({ where }),
      this.prisma.phase.findMany({ where }),
      this.prisma.deliverable.findMany({ where }),
      this.prisma.costAccount.findMany({ where }),
      this.prisma.projectMember.findMany({ where: { ...where, active: true } }),
      this.prisma.wpDependency.findMany({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
    const byCode = new Map(existing.map((w) => [w.code, w]));
    const fileCodes = new Map<string, Row>();

    type Plan = {
      row: Row; code: string; name: string; parentCode: string | null; isMilestone: boolean; durationDays: number | null;
      ownerId?: string | null; phaseId?: string | null; deliverableId?: string | null; costAccountId?: string | null;
      budget?: number | null; resourceDays?: number | null; externalProvider?: string | null; longLead?: boolean; preds: string[];
    };
    const plans: Plan[] = [];
    const num = (s: string | undefined, label: string, line: number, min = 0) => {
      if (!s) return null;
      const n = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < min) { errors.push(`第 ${line} 行：${label}“${s}”不是有效的数字`); return null; }
      return n;
    };
    for (const r of rows) {
      const L = r.line;
      const code = r.v.code ?? '';
      const name = r.v.name ?? '';
      if (!code) { errors.push(`第 ${L} 行：编号为空`); continue; }
      if (!CODE.test(code)) { errors.push(`第 ${L} 行：编号“${code}”格式不对（字母、数字、点、横线，最长 40 位）`); continue; }
      if (fileCodes.has(code)) { errors.push(`第 ${L} 行：编号“${code}”与第 ${fileCodes.get(code)!.line} 行重复`); continue; }
      fileCodes.set(code, r);
      if (!name) errors.push(`第 ${L} 行：名称为空`);
      const isMilestone = colOf.has('milestone') ? yes(r.v.milestone ?? '') : byCode.get(code)?.isMilestone ?? false;
      const dur = num(r.v.duration, '工期', L, 0);
      if (dur !== null && !Number.isInteger(dur)) errors.push(`第 ${L} 行：工期必须是整数`);
      const p: Plan = {
        row: r, code, name, parentCode: r.v.parent || null, isMilestone, durationDays: isMilestone ? 0 : dur,
        preds: (r.v.preds ?? '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean),
      };
      if (colOf.has('owner')) {
        const o = r.v.owner ?? '';
        if (!o) p.ownerId = null;
        else {
          const u = users.find((x) => x.name === o || x.email.toLowerCase() === o.toLowerCase());
          if (!u) errors.push(`第 ${L} 行：负责人“${o}”不是本项目的成员`); else p.ownerId = u.id;
        }
      }
      const lookup = <T extends { id: string }>(k: Key, label: string, xs: T[], f: (x: T) => string, set: (id: string | null) => void) => {
        if (!colOf.has(k)) return;
        const val = r.v[k] ?? '';
        if (!val) return set(null);
        const hit = xs.find((x) => f(x) === val);
        if (!hit) errors.push(`第 ${L} 行：${label}“${val}”在项目里不存在`); else set(hit.id);
      };
      lookup('phase', '阶段', phases, (x) => x.name, (id) => (p.phaseId = id));
      lookup('deliverable', '交付物', deliverables, (x) => x.name, (id) => (p.deliverableId = id));
      lookup('account', '成本科目', accounts, (x) => x.code, (id) => (p.costAccountId = id));
      if (colOf.has('budget')) p.budget = num(r.v.budget, '预算', L);
      if (colOf.has('resource')) p.resourceDays = num(r.v.resource, '人天', L);
      if (colOf.has('provider')) p.externalProvider = r.v.provider || null;
      if (colOf.has('longLead')) p.longLead = yes(r.v.longLead ?? '');
      plans.push(p);
    }

    // 结构：上级存在、无环；末级必须有工期；依赖只连末级且无环
    const allCodes = new Set([...byCode.keys(), ...fileCodes.keys()]);
    const parentOf = new Map<string, string | null>([...existing.map((w) => [w.code, w.parentId ? existing.find((x) => x.id === w.parentId)?.code ?? null : null] as const)]);
    for (const p of plans) {
      if (p.parentCode && !allCodes.has(p.parentCode)) errors.push(`第 ${p.row.line} 行：上级编号“${p.parentCode}”不存在`);
      if (p.parentCode === p.code) errors.push(`第 ${p.row.line} 行：上级不能是自己`);
      parentOf.set(p.code, p.parentCode);
    }
    for (const code of allCodes) {
      const seen = new Set<string>();
      let cur: string | null | undefined = code;
      while (cur) { if (seen.has(cur)) { errors.push(`编号“${code}”的上级关系形成了循环`); break; } seen.add(cur); cur = parentOf.get(cur); }
    }
    const hasKids = new Set([...parentOf.values()].filter(Boolean) as string[]);
    for (const p of plans) {
      if (!hasKids.has(p.code) && !p.isMilestone && (p.durationDays === null ? byCode.get(p.code)?.durationDays ?? null : p.durationDays) === null) {
        errors.push(`第 ${p.row.line} 行：末级工作包“${p.code}”需要填写工期`);
      }
      if (!hasKids.has(p.code) && !p.isMilestone && p.durationDays === 0) errors.push(`第 ${p.row.line} 行：工期为 0 的请标记为里程碑`);
      for (const pr of p.preds) {
        if (!allCodes.has(pr)) errors.push(`第 ${p.row.line} 行：前置工作包“${pr}”不存在`);
        else if (hasKids.has(pr) || hasKids.has(p.code)) errors.push(`第 ${p.row.line} 行：依赖只能建在末级工作包之间（${pr} → ${p.code}）`);
      }
    }
    const idOfCode = new Map(existing.map((w) => [w.code, w.id]));
    const codeOfId = new Map(existing.map((w) => [w.id, w.code]));
    const edges = [
      ...deps.map((d) => ({ predecessorId: codeOfId.get(d.predecessorId)!, successorId: codeOfId.get(d.successorId)! })),
      ...plans.flatMap((p) => p.preds.map((pr) => ({ predecessorId: pr, successorId: p.code }))),
    ];
    try { topoOrder([...allCodes], edges); } catch (e) { if (e instanceof CycleError) errors.push('前置关系形成了循环'); else throw e; }

    const creates = plans.filter((p) => !byCode.has(p.code));
    if (creates.length) {
      try { await this.guard.assertAllowed(ctx, changeRequestId); } catch { errors.push(`计划已批准：新增 ${creates.length} 个工作包需要引用一项已批准的范围变更`); }
    }
    for (const p of plans) {
      const w = byCode.get(p.code);
      if (w?.status === WpStatus.VERIFIED) errors.push(`第 ${p.row.line} 行：工作包“${p.code}”已验证，不能修改`);
    }
    if (errors.length) throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Import failed', errors: errors.slice(0, 50) });

    // 写入：先按上级顺序建工作包，再建依赖
    const depthOf = (c: string): number => (parentOf.get(c) ? depthOf(parentOf.get(c)!) + 1 : 0);
    const ordered = [...plans].sort((a, b) => depthOf(a.code) - depthOf(b.code));
    const existingEdge = new Set(deps.map((d) => `${d.predecessorId}>${d.successorId}`));
    let created = 0, updated = 0, depsAdded = 0;
    await this.prisma.txn(async (tx) => {
      for (const p of ordered) {
        const data = {
          name: p.name, isMilestone: p.isMilestone,
          ...(p.durationDays !== null ? { durationDays: p.durationDays } : {}),
          ...(p.ownerId !== undefined ? { ownerId: p.ownerId } : {}),
          ...(p.phaseId !== undefined ? { phaseId: p.phaseId } : {}),
          ...(p.deliverableId !== undefined ? { deliverableId: p.deliverableId } : {}),
          ...(p.costAccountId !== undefined ? { costAccountId: p.costAccountId } : {}),
          ...(p.budget !== undefined ? { budget: p.budget } : {}),
          ...(p.resourceDays !== undefined ? { resourceDays: p.resourceDays } : {}),
          ...(p.externalProvider !== undefined ? { externalProvider: p.externalProvider } : {}),
          ...(p.longLead !== undefined ? { longLead: p.longLead } : {}),
          parentId: p.parentCode ? idOfCode.get(p.parentCode)! : null,
        };
        const hit = byCode.get(p.code);
        if (hit) {
          await tx.workPackage.update({ where: { id: hit.id }, data });
          updated++;
        } else {
          const w = await tx.workPackage.create({ data: { ...data, durationDays: p.durationDays ?? 1, tenantId: ctx.tenantId, projectId, code: p.code } });
          idOfCode.set(p.code, w.id);
          created++;
        }
      }
      for (const p of plans) {
        for (const pr of p.preds) {
          const a = idOfCode.get(pr)!;
          const b = idOfCode.get(p.code)!;
          if (existingEdge.has(`${a}>${b}`)) continue;
          await tx.wpDependency.create({ data: { tenantId: ctx.tenantId, projectId, predecessorId: a, successorId: b } });
          existingEdge.add(`${a}>${b}`);
          depsAdded++;
        }
      }
      await this.audit.record(
        { tenantId: ctx.tenantId, actorId: actor.id, action: 'wbs.import', entity: 'Project', entityId: projectId, after: { created, updated, dependencies: depsAdded, changeRequestId: changeRequestId ?? null } },
        tx,
      );
    });
    return { created, updated, dependencies: depsAdded };
  }
}
