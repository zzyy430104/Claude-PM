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
  delete(path: string) {
    return firstValueFrom(this.http.delete(`${API}${path}`));
  }
}

/** 把后端错误转成用户能看懂的中文提示 */
export function errorMessage(e: unknown, fallback = '操作失败'): string {
  if (!(e instanceof HttpErrorResponse)) return fallback;
  const body = e.error as { code?: string; message?: string | string[] } | null;
  if (body?.code === 'CHANGE_REQUEST_REQUIRED') return '项目已建立基线，此项修改需要先提交并批准变更申请';
  if (body?.code === 'OPEN_ISSUES') return '此前评审遗留的问题还没关闭，需要先关闭，或由最高管理层授权后才能通过';
  if (body?.code === 'MANDATORY_PARTICIPANTS_MISSING') {
    const missing = (e.error as { missing?: string[] }).missing ?? [];
    return `必选参与者未出席：${missing.join('、')}`;
  }
  if (body?.code === 'GATE_CRITERIA_NOT_MET') {
    const b = (e.error as { blockers?: { checklist: string[]; workPackages: string[]; deliverables: string[] } }).blockers;
    return `关口准则未满足，不能直接通过（请选择“有条件通过”并制定行动计划）。未通过清单项 ${b?.checklist.length ?? 0} 个，未核验工作包 ${b?.workPackages.length ?? 0} 个，未接受交付物 ${b?.deliverables.length ?? 0} 个`;
  }
  if (body?.code === 'BUDGET_ALLOCATION_EXCEEDED') return '各成本科目预算之和超过了项目预算，如需增加请先走预算变更';
  if (body?.code === 'QUALITY_PLAN_INCOMPLETE') return '质量计划至少要包含一项质量保证（QA）和一项质量控制（QC）活动';
  if (body?.code === 'NC_INCOMPLETE') return (e.error as { problems?: string[] }).problems?.join('；') ?? '信息不完整';
  if (body?.code === 'CUSTOMER_NOT_NOTIFIED') return '客户交期变更须先通知客户，请先记录“已通知客户”';
  if (body?.code === 'CUSTOMER_AGREEMENT_REQUIRED') return '客户尚未同意，请先记录“客户已同意”';
  if (body?.code === 'TOP_MANAGEMENT_REQUIRED') return '预算增加必须由最高管理层批准';
  if (body?.code === 'CHANGE_INCOMPLETE') return (e.error as { problems?: string[] }).problems?.join('；') ?? '变更申请信息不完整';
  if (e.status === 403) return '没有权限执行此操作';
  if (e.status === 404) return '记录不存在或无权访问';
  const msg = Array.isArray(body?.message) ? body!.message.join('；') : body?.message;
  return msg ? `${fallback}：${msg}` : fallback;
}
