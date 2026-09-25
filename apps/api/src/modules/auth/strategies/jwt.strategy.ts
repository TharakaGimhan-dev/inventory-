// jwt.strategy.ts verifies the access token and builds the request user.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../../../common/types/authenticated-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      // Cookie first (the web app), Authorization header second (mobile, API
      // clients). httpOnly cookies are not readable by injected scripts.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => req?.cookies?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
      // Pinned. Left open, a verifier accepts whatever algorithm the token's
      // own header names - the family of algorithm-confusion attacks. There is
      // one algorithm in use here and it is named here.
      algorithms: ['HS256'],
    });
  }

  // Runs only after the signature and expiry have been verified.
  validate(payload: AccessTokenPayload): AuthenticatedUser {
    // A token with no tenant claim cannot be scoped, and an unscoped token is
    // exactly what the isolation layers exist to prevent.
    if (!payload.tid) {
      throw new UnauthorizedException('Token is not scoped to a tenant');
    }

    return {
      id: payload.sub,
      email: payload.email,
      tenantId: payload.tid,
      role: payload.role,
      platformRole: payload.prole,
    };
  }
}
