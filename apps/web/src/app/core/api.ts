import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API } from './auth.service';

/** 对 HttpClient 的薄封装：路径相对 /api，返回 Promise */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${API}${path}`));
  }
  post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${API}${path}`, body));
  }
  put<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.put<T>(`${API}${path}`, body));
  }
  patch<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.patch<T>(`${API}${path}`, body));
  }
  /** 下载受保护的文件：带上令牌取回二进制，再交给浏览器保存 */
  async download(path: string, fileName: string) {
    const blob = await firstValueFrom(this.http.get(`${API}${path}`, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    // 需要先挂到页面上再点击，部分浏览器才会采用 download 属性里的文件名
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  upload<T>(path: string, form: FormData) {
    return firstValueFrom(this.http.post<T>(`${API}${path}`, form));
  }
  delete(path: string) {
    return firstValueFrom(this.http.delete(`${API}${path}`));
  }
}

/** 把后端错误转成用户能看懂的中文提示 */
export function errorMessage(e: unknown, fallback = '操作失败'): string {
  if (!(e instanceof HttpErrorResponse)) return fallback;
  const body = e.error as { code?: string; message?: string | string[] } | null;
  if (body?.code === 'CHANGE_REQUEST_REQUIRED') return '项目计划已批准，此项修改需要引用一项已批准的变更申请';
  if (body?.code === 'OPEN_ISSUES') return '此前评审遗留的问题还没关闭，需要先关闭，或由最高管理层授权后才能通过';
  if (body?.code === 'MANDATORY_PARTICIPANTS_MISSING') {
    const missing = (e.error as { missing?: string[] }).missing ?? [];
    return `必选参与者未出席：${missing.join('、')}`;
  }
  if (body?.code === 'GATE_CRITERIA_NOT_MET') {
    const b = (e.error as { blockers?: { checklist: string[]; workPackages: string[]; deliverables: string[] } }).blockers;
    return `关口准则未满足，不能直接通过（请选择“有条件通过”并制定行动计划）。未通过清单项 ${b?.checklist.length ?? 0} 个，未核验工作包 ${b?.workPackages.length ?? 0} 个，未接受交付物 ${b?.deliverables.length ?? 0} 个`;
  }
  if (body?.code === 'PROJECT_CLOSE_BLOCKED') return `暂不能关闭项目：${(e.error as { blockers?: string[] }).blockers?.join('；')}`;
  if (body?.code === 'PBS_INCOMPLETE') return `产品分解结构必须分解到最低可更换单元，以下末级项还未标记：${(e.error as { items?: string[] }).items?.join('、')}`;
  if (body?.code === 'TENDER_INCOMPLETE') return (e.error as { problems?: string[] }).problems?.join('；') ?? '投标信息不完整';
  if (e.status === 413) return '文件太大';
  if (body?.code === 'BUDGET_ALLOCATION_EXCEEDED') return '各成本科目预算之和超过了项目预算，如需增加请先走预算变更';
  if (body?.code === 'QUALITY_PLAN_INCOMPLETE') return '质量计划至少要包含一项质量保证（QA）和一项质量控制（QC）活动';
  if (body?.code === 'NC_INCOMPLETE') return (e.error as { problems?: string[] }).problems?.join('；') ?? '信息不完整';
  if (body?.code === 'CUSTOMER_NOT_NOTIFIED') return '客户交期变更须先通知客户，请先记录“已通知客户”';
  if (body?.code === 'CUSTOMER_AGREEMENT_REQUIRED') return '客户尚未同意，请先记录“客户已同意”';
  if (body?.code === 'TOP_MANAGEMENT_REQUIRED') return '预算增加必须由最高管理层批准';
  if (body?.code === 'CHANGE_INCOMPLETE') return (e.error as { problems?: string[] }).problems?.join('；') ?? '变更申请信息不完整';
  if (body?.code === 'INSPECTION_INCOMPLETE') return `还不能核验：${(e.error as { blockers?: string[] }).blockers?.join('；')}`;
  if (body?.code === 'RATE_REASON_REQUIRED') return '人工费率与标准费率不同，请写明原因';
  if (body?.code === 'NA_REASON_REQUIRED') return '选“不适用”时请写明理由';
  if (body?.code === 'AI_DISABLED') return 'AI 辅助没有启用，请企业管理员在“企业设置 → AI 辅助”里设置';
  if (body?.code === 'AI_SCENARIO_DISABLED') return '这个 AI 场景已关闭';
  if (body?.code === 'AI_LIMIT') return '今天的 AI 调用次数已用完';
  if (body?.code === 'AI_FAILED') return 'AI 没有返回可用的结果，请重试或手工填写';
  if (body?.code === 'AI_INPUT_TOO_LONG') return '内容太长，超过了 AI 的文字上限，请删减后再试';
  if (body?.code === 'AI_FILE_TYPE') return '只支持 PDF、Word（.docx）、Excel（.xlsx）和文本文件';
  if (body?.code === 'AI_FILE_TOO_LARGE') return '文件超过了大小上限';
  if (body?.code === 'AI_FILE_NO_TEXT') return 'PDF 是扫描图片，没有文字，请先做文字识别（OCR）';
  if (body?.code === 'AI_NOT_CONFIGURED') return '还没有设置 API 密钥';
  if (body?.code === 'MEETING_CLOSED') return '纪要已发布或会议已取消，不能再修改';
  if (body?.code === 'MINUTES_EMPTY') return '请先填写讨论要点或决定事项';
  if (body?.code === 'MEETING_NOT_HELD') return '会议还没开始，不能发布纪要';
  if (body?.code === 'PURCHASE_ORDERED') return '已下单的物料不能删除或改金额、科目；如不再需要请“取消”';
  if (body?.code === 'PURCHASE_EMPTY') return '采购计划还没有物料';
  if (body?.code === 'ACCOUNT_REQUIRED') return '请先为该物料选择成本科目';
  if (body?.code === 'OPEN_POINTS_REQUIRED') return '有条件通过时请填写遗留项';
  if (body?.code === 'HANDOVER_INCOMPLETE') return `请先填写：${(e.error as { missing?: string[] }).missing?.join('、') ?? ''}`;
  if (body?.code === 'HANDOVER_SUBMITTED') return '交接已发起；要修改请先“撤回修改”';
  if (body?.code === 'EVALUATION_CONFIRMED') return '项目经理绩效已由管理层确认，不能再修改';
  if (body?.code === 'EVALUATION_INCOMPLETE') return '还有评价方面没有分数（自定义方面由管理层打分）';
  if (body?.code === 'EVALUATION_SUBMITTED') return '评价已提交并锁定；要修改请先“撤回修改”';
  if (body?.code === 'SCORES_INCOMPLETE') return `还有维度没有打分：${(e.error as { missing?: string[] }).missing?.join('、') ?? ''}`;
  if (body?.code === 'REASON_REQUIRED') return '请写明理由';
  if (body?.code === 'DUPLICATE_NAME') return '名称已存在';
  if (body?.code === 'CBA_REQUIRED') return '选了应对策略，请先写成本收益分析';
  if (body?.code === 'ACCEPT_REASON_REQUIRED') return '选“接受”时请写明理由';
  if (body?.code === 'CONTINGENCY_REQUIRED') return '按规则，选“接受”还需要写应急预案';
  if (body?.code === 'CLOSE_NOT_ALLOWED') return '按规则，这条风险由项目经理或管理层确认关闭';
  if (body?.code === 'MEASURES_OPEN') return '还有措施没有完成，不能关闭';
  if (body?.code === 'ACCEPT_NOT_APPROVED') return '“接受”还没有经管理层确认，不能关闭';
  if (body?.code === 'UNKNOWN_STRATEGY') return '应对策略不在企业设置的列表里';
  if (body?.code === 'UNKNOWN_CATEGORY') return '检验类别不存在，请先在企业设置里添加';
  if (body?.code === 'PLAN_CHECK_FAILED') return `计划还有未通过的检查：${(e.error as { problems?: string[] }).problems?.join('；')}`;
  if (body?.code === 'WRONG_PASSWORD') return '当前密码不正确';
  if (body?.code === 'SAME_PASSWORD') return '新密码不能与当前密码相同';
  if (body?.code === 'PASSWORD_CHANGE_REQUIRED') return '请先修改初始密码';
  if (e.status === 429) return '尝试次数过多，请稍后再试';
  if (e.status === 403) return '没有权限执行此操作';
  if (e.status === 404) return '记录不存在或无权访问';
  const msg = Array.isArray(body?.message) ? body!.message.join('；') : body?.message;
  return msg ? `${fallback}：${msg}` : fallback;
}
