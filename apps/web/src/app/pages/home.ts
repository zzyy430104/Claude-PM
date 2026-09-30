import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-home',
  template: `
    <div class="page">
      <h1>欢迎，{{ auth.user()?.name }}</h1>
      <p>请从左侧进入「项目」。</p>
    </div>
  `,
})
export class HomePage {
  readonly auth = inject(AuthService);
}
