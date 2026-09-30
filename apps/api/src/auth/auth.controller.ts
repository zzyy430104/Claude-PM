import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clearRefreshCookie, CSRF_HEADER, CSRF_VALUE, readCookie, REFRESH_COOKIE, setRefreshCookie } from '../common/cookies.js';
import { CurrentUser, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { AuthService } from './auth.service.js';
import { LoginDto, SignupDto } from './dto.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, req.ip ?? '');
  }

  /** 访问令牌放在响应体里（前端只存内存），刷新令牌只通过 httpOnly Cookie 下发 */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.auth.login(dto, req.ip ?? '');
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new ForbiddenException('Missing CSRF header');
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException('No refresh token');
    try {
      const { accessToken, refreshToken } = await this.auth.refresh(token);
      setRefreshCookie(res, refreshToken);
      return { accessToken };
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.id, user.tenantId, readCookie(req, REFRESH_COOKIE));
    clearRefreshCookie(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
