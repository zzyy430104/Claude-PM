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
  if (body?.code === 'OPEN_ISSUES') return '上一阶段还有未关闭的问题，需要最高管理层授权才能通过';
  if (e.status === 403) return '没有权限执行此操作';
  if (e.status === 404) return '记录不存在或无权访问';
  const msg = Array.isArray(body?.message) ? body!.message.join('；') : body?.message;
  return msg ? `${fallback}：${msg}` : fallback;
}
