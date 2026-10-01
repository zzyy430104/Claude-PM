import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';

/** 企业品牌：系统名称和企业名称，在“企业设置”里修改，顶栏和工作台显示 */
@Injectable({ providedIn: 'root' })
export class Brand {
  private readonly api = inject(Api);
  readonly systemName = signal('Claude-PM');
  readonly companyName = signal('');

  async load() {
    try {
      const b = await this.api.get<{ systemName: string; companyName: string }>('/branding');
      this.set(b.systemName, b.companyName);
    } catch { /* 平台管理员没有企业，沿用默认名称 */ }
  }
  set(systemName: string, companyName: string) {
    this.systemName.set(systemName || 'Claude-PM');
    this.companyName.set(companyName);
    document.title = this.systemName();
  }
}
