import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';

/** 企业品牌：系统名称和企业名称，在“企业设置”里修改，顶栏和工作台显示 */
@Injectable({ providedIn: 'root' })
export class Brand {
  private readonly api = inject(Api);
  readonly systemName = signal('Claude-PM');
  readonly companyName = signal('');
  /** 小项目免立项：允许不经立项直接建项目 */
  readonly allowDirectProject = signal(false);
  /** 检验 / 验证项的类别（企业设置里维护） */
  readonly inspectionCategories = signal<string[]>(['产品', '过程', '文件', '评审', '试验']);

  async load() {
    try {
      const b = await this.api.get<{ systemName: string; companyName: string; allowDirectProject?: boolean; inspectionCategories?: string[] }>('/branding');
      this.set(b.systemName, b.companyName);
      this.allowDirectProject.set(!!b.allowDirectProject);
      if (b.inspectionCategories?.length) this.inspectionCategories.set(b.inspectionCategories);
    } catch { /* 平台管理员没有企业，沿用默认名称 */ }
  }
  set(systemName: string, companyName: string) {
    this.systemName.set(systemName || 'Claude-PM');
    this.companyName.set(companyName);
    document.title = this.systemName();
  }
}
