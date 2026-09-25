// auth.controller.ts exposes the auth routes. Tokens are set as httpOnly
// cookies AND returned in the body: the web app uses the cookies, mobile and
// API clients use the body.
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  LoginInput, RegisterInput, SwitchTenantInput,
  loginSchema, registerSchema, switchTenantSchema,
} from '../schemas/auth.schema';
import { AuthService } from '../service/auth.service';
import { THROTTLE } from '../../../common/security/throttler.config';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // Five an hour per address, so one script cannot fill the database with
  // tenants and email verifications.
  @Throttle({ default: { ttl: THROTTLE.SIGNUP.ttl, limit: THROTTLE.SIGNUP.limit } })
  @Post('register')
  @ApiOperation({ summary: 'Create a user, a tenant and an owner membership' })
  async register(
    // The pipe is bound to @Body, never applied with @UsePipes at method level:
    // a method-level pipe runs against EVERY parameter, so it would also be
    // handed the @CurrentUser() object and strip it to whatever the schema
    // declares.
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tenant } = await this.auth.register(body);
    const tokens = await this.auth.login({
      email: body.email,
      password: body.password,
    });

    this.setCookies(res, tokens.accessToken, tokens.refreshToken);

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      ...tokens,
    };
  }

  @Public()
  // Ten a minute per address. A person mistypes two or three times, never ten;
  // every attempt past that is a guess. The per-account lockout in
  // LoginAttemptsService covers an attacker spread across many addresses.
  @Throttle({ default: { ttl: THROTTLE.AUTH.ttl, limit: THROTTLE.AUTH.limit } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(body, req.ip);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  @Public()
  @Throttle({ default: { ttl: THROTTLE.AUTH.ttl, limit: 30 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token =
      (req as any).cookies?.refresh_token ?? (req.body as any)?.refreshToken;
    const tokens = await this.auth.refresh(token);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  @Post('switch-tenant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-issue the access token for another tenant' })
  async switchTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(switchTenantSchema)) body: SwitchTenantInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.switchTenant(user.id, body.tenantId);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { ttl: THROTTLE.AUTH.ttl, limit: THROTTLE.AUTH.limit } })
  @ApiOperation({ summary: 'Change your password and sign out everywhere' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });

    return result;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke this session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.id);
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string) {
    // httpOnly so injected script cannot read them; sameSite lax so a form POST
    // from another origin cannot ride the session.
    const base = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, {
      ...base,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      // Scoped to the refresh route, so the long-lived token is not sent on
      // every ordinary request.
      path: '/api/v1/auth/refresh',
    });
  }
}
