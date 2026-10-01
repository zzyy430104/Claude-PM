import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ProjectType } from '../generated/prisma/enums.js';
import type { AuthUser } from '../common/auth.types.js';
import { isGroup, type Condition, type TemplateRow } from './plan-templates.js';
import { PlanningService } from './planning.service.js';

const KIND = { group: '阶段', line: '工作线', item: '工作包', milestone: '里程碑' } as const;
const COND_LABEL: Record<Condition, string> = { drawingApproval: '客户图纸审批', customerWitness: '客户见证', rams: 'RAMS', longLead: '长周期物料' };
const HEAD = ['编号', '名称', '类别', '工期（工作日）', '前置（编号，逗号分隔）', '责任角色', '交付物 / 记录', '条件'];

/** A/B/C 计划模板的 Excel 导出与导入（企业按自己的产品修改模板） */
@Injectable()
export class PlanTemplateExcelService {
  constructor(private readonly planning: PlanningService) {}

  async export(actor: AuthUser, type: ProjectType) {
    const t = await this.planning.getTemplate(actor, type);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${type} 类模板`);
    ws.addRow(HEAD).font = { bold: true };
    for (const r of t.items) {
      if (isGroup(r)) ws.addRow([r.code, r.name, r.phase ? KIND.group : KIND.line]).font = { bold: true };
      else ws.addRow([r.code, r.name, r.milestone ? KIND.milestone : KIND.item, r.milestone ? 0 : r.durationDays, r.predecessors.join(', '), r.role, r.deliverable, r.condition ? COND_LABEL[r.condition] : '']);
    }
    ws.columns.forEach((c, i) => { c.width = [8, 36, 10, 14, 22, 12, 24, 14][i]; });
    const help = wb.addWorksheet('填写说明');
    for (const line of [
      '类别：阶段（一级，生成项目时同时建立阶段）、工作线（一级，不建阶段，如采购）、工作包、里程碑（工期为 0）。',
      '二级编号必须以一级编号开头，如 2.3 属于 2。前置填同一模板里的工作包编号，用逗号分隔。',
      `条件：${Object.values(COND_LABEL).join('、')}。立项时没有选上的条件，生成计划时去掉该工作包并接好依赖；B/C 类不做 FAI 时去掉名称以“FAI”开头的阶段。`,
      '责任角色填“用户与角色 → 职能角色”里的名称。',
    ]) help.addRow([line]);
    help.getColumn(1).width = 120;
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `plan-template-${type}.xlsx` };
  }

  async import(actor: AuthUser, type: ProjectType, file: Buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Not a readable .xlsx file', problems: ['文件不是有效的 Excel（.xlsx）文件'] });
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException({ code: 'EXCEL_INVALID', message: 'Empty workbook', problems: ['文件里没有工作表'] });
    const rows: TemplateRow[] = [];
    const problems: string[] = [];
    const text = (v: ExcelJS.CellValue) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : String(v)).trim();
    const condOf = Object.fromEntries(Object.entries(COND_LABEL).map(([k, v]) => [v, k as Condition]));
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const [code, name, kind, dur, preds, role, deliv, cond] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => text(row.getCell(i).value));
      if (!code && !name) return;
      if (!code || !name) { problems.push(`第 ${n} 行：编号和名称都要填`); return; }
      if (kind === KIND.group || kind === KIND.line) { rows.push({ code, name, group: true, phase: kind === KIND.group ? name : null }); return; }
      if (kind !== KIND.item && kind !== KIND.milestone) { problems.push(`第 ${n} 行：类别“${kind}”不对，应为 阶段、工作线、工作包 或 里程碑`); return; }
      const d = kind === KIND.milestone ? 0 : Number(dur);
      if (!Number.isInteger(d) || d < (kind === KIND.milestone ? 0 : 1) || d > 3650) { problems.push(`第 ${n} 行：工期要填 1–3650 的整数`); return; }
      if (cond && !condOf[cond]) { problems.push(`第 ${n} 行：条件“${cond}”不对，可选 ${Object.values(COND_LABEL).join('、')}`); return; }
      rows.push({
        code, name, durationDays: d, predecessors: preds ? preds.split(/[,，、\s]+/).filter(Boolean) : [], role, deliverable: deliv,
        ...(kind === KIND.milestone ? { milestone: true } : {}), ...(cond ? { condition: condOf[cond] } : {}),
      });
    });
    if (problems.length) throw new BadRequestException({ code: 'TEMPLATE_INVALID', message: problems.join('；'), problems });
    if (!rows.length) throw new BadRequestException({ code: 'TEMPLATE_INVALID', message: 'No rows', problems: ['没有读到任何行'] });
    return this.planning.saveTemplate(actor, type, rows);
  }
}
