import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ProjectType } from '../generated/prisma/enums.js';

/**
 * 项目要求：立项时批准，项目内不能突破；只能通过“项目要求变更”改。
 * 时间（关键节点、全部交付日）、交付物、质量、成本，以及初步风险。C 类的交付物来自库存计划行。
 */
export class MilestoneReqDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsDateString() date: string;
}
export class DeliverableReqDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsString() @MaxLength(50) quantity: string;
  @IsIn(['PRODUCT', 'DOCUMENT']) kind: 'PRODUCT' | 'DOCUMENT';
}
export class StockLineDto {
  @IsString() @MinLength(1) @MaxLength(200) product: string;
  @IsNumber() @Min(1) quantity: number;
  @IsDateString() date: string;
}
export class QualityReqDto {
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(100, { each: true }) standards: string[];
  @IsString() @MaxLength(2000) special: string;
  @IsString() @MaxLength(200) acceptance: string;
  /** 是否做 FAI；A 类必须做 */
  @IsBoolean() fai: boolean;
  /** 不做 FAI 的理由 */
  @IsString() @MaxLength(500) faiReason: string;
  /** 客户见证 FAI 或客户批准首件 */
  @IsBoolean() customerWitness: boolean;
  /** 图纸须经客户审批 */
  @IsBoolean() drawingApproval: boolean;
  /** 合同要求 RAMS 分析 */
  @IsBoolean() rams: boolean;
}
export class CostReqDto {
  /** 成本上限（元） */
  @IsNumber() @Min(0) cap: number;
  @IsOptional() @IsNumber() @Min(0) target?: number;
}
export class RiskReqDto {
  @IsString() @MinLength(1) @MaxLength(200) text: string;
  @IsIn(['RISK', 'OPPORTUNITY']) kind: 'RISK' | 'OPPORTUNITY';
}
export class RequirementsDto {
  /** 全部交付（C 类为全部入库）的日期 */
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MilestoneReqDto) milestones: MilestoneReqDto[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DeliverableReqDto) deliverables: DeliverableReqDto[];
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockLineDto) stockLines: StockLineDto[];
  @ValidateNested() @Type(() => QualityReqDto) quality: QualityReqDto;
  @ValidateNested() @Type(() => CostReqDto) cost: CostReqDto;
  /** 有长周期物料，需要提前订货 */
  @IsBoolean() longLead: boolean;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RiskReqDto) risks: RiskReqDto[];
}

/** 要求变更只提交改动的部分，未提交的字段沿用当前版本 */
export class PartialRequirementsDto {
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MilestoneReqDto) milestones?: MilestoneReqDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DeliverableReqDto) deliverables?: DeliverableReqDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockLineDto) stockLines?: StockLineDto[];
  @IsOptional() @ValidateNested() @Type(() => QualityReqDto) quality?: QualityReqDto;
  @IsOptional() @ValidateNested() @Type(() => CostReqDto) cost?: CostReqDto;
  @IsOptional() @IsBoolean() longLead?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RiskReqDto) risks?: RiskReqDto[];
}

export type Requirements = {
  deliveryDate?: string;
  milestones: { name: string; date: string }[];
  deliverables: { name: string; quantity: string; kind: 'PRODUCT' | 'DOCUMENT' }[];
  stockLines: { product: string; quantity: number; date: string }[];
  quality: { standards: string[]; special: string; acceptance: string; fai: boolean; faiReason: string; customerWitness: boolean; drawingApproval: boolean; rams: boolean };
  cost: { cap: number; target?: number };
  longLead: boolean;
  risks: { text: string; kind: 'RISK' | 'OPPORTUNITY' }[];
};

export const EMPTY_REQUIREMENTS: Requirements = {
  milestones: [], deliverables: [], stockLines: [], risks: [], longLead: false,
  quality: { standards: [], special: '', acceptance: '', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false },
  cost: { cap: 0 },
};

export function asRequirements(v: unknown): Requirements {
  const r = (v ?? {}) as Partial<Requirements>;
  return {
    ...EMPTY_REQUIREMENTS, ...r,
    quality: { ...EMPTY_REQUIREMENTS.quality, ...r.quality },
    cost: { ...EMPTY_REQUIREMENTS.cost, ...r.cost },
  };
}

/** C 类没有客户合同：交付物和交付日期来自库存计划行 */
export function effectiveDeliveryDate(type: ProjectType, r: Requirements): string | undefined {
  if (type === ProjectType.C && r.stockLines.length) return r.stockLines.map((l) => l.date).sort().at(-1);
  return r.deliveryDate;
}

/** 提交审批前的完整性检查，返回缺什么（空数组 = 齐全） */
export function requirementProblems(
  i: { type: ProjectType; name: string; projectCode: string; customer: string; proposedPmId: string | null; startDate: Date | null },
  r: Requirements,
): string[] {
  const p: string[] = [];
  if (!i.projectCode.trim()) p.push('项目编号');
  if (!i.proposedPmId) p.push('项目经理');
  if (!i.startDate) p.push('计划开始日期');
  if (i.type === ProjectType.C) {
    if (!r.stockLines.length) p.push('库存计划行（产品、数量、要求日期）');
  } else {
    if (!i.customer.trim()) p.push('客户');
    if (!r.deliveryDate) p.push('全部交付日期');
    if (!r.deliverables.some((d) => d.kind === 'PRODUCT')) p.push('产品交付物');
  }
  if (!(r.cost.cap > 0)) p.push('成本上限');
  if (i.type !== ProjectType.A && !r.quality.fai && !r.quality.faiReason.trim()) p.push('不做 FAI 的理由');
  const due = effectiveDeliveryDate(i.type, r);
  if (due && i.startDate && due < i.startDate.toISOString().slice(0, 10)) p.push('交付日期不能早于开始日期');
  return p;
}

export const TYPE_LABEL: Record<ProjectType, string> = { A: 'A 类', B: 'B 类', C: 'C 类' };
