import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-home',
  template: `
    <div class="page">
      <h1>欢迎，{{ auth.user()?.name }}</h1>
      <p>项目、阶段评审、变更控制等模块将在后续批次上线。当前可使用用户管理与审计日志。</p>
    </div>
  `,
})
export class HomePage {
  readonly auth = inject(AuthService);
}
