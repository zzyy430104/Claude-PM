import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** 管理员设置或重置的密码必须先改掉，改之前只能进入“修改密码”页 */
export const passwordGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.user()?.mustChangePassword && !state.url.startsWith('/account')
    ? inject(Router).createUrlTree(['/account'])
    : true;
};

export const roleGuard =
  (...roles: Role[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    return auth.hasRole(...roles) ? true : inject(Router).createUrlTree(['/']);
  };
