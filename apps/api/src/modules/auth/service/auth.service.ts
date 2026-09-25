// auth.service.ts owns registration, login, token issue and revocation.
import {
  ConflictException, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Sequelize } from 'sequelize-typescript';
import {
  MembershipStatus, PlatformRole, TenantRole, TenantStatus,
} from '../../../common/constants/roles';
import { REDIS_CLIENT } from '../../../configs/redis/redis.module';
import {
  AccessTokenPayload, RefreshTokenPayload,
} from '../../../common/types/authenticated-user';
import { Plan } from '../../billing/models/plan.model';
import { Membership } from '../../tenant/models/membership.model';
import { Tenant } from '../../tenant/models/tenant.model';
import { User } from '../../user/models/user.model';
import { LoginInput, RegisterInput } from '../schemas/auth.schema';

// @nestjs/jwt types expiresIn as the `ms` library's template literal union
// ('15m', '30d', ...). The value comes from the environment as a plain string,
// so it is narrowed here rather than weakening the env schema's type.
type Duration = Exclude<
  Parameters<JwtService['signAsync']>[1],
  undefined
>['expiresIn'];

const asDuration = (value: string): Duration => value as Duration;

// Cost 12 is the current sensible default: slow enough to make an offline
// attack on a leaked hash expensive, fast enough not to be its own DoS.
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Membership) private readonly memberships: typeof Membership,
    @InjectModel(Plan) private readonly plans: typeof Plan,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates user + tenant + owner membership as one unit.
   *
   * Unlike the Firebase app, signup is open - that is the free tier's
   * acquisition path. A partial result here would be a user who cannot log in
   * anywhere, so all four writes share one transaction.
   */
  async register(input: RegisterInput) {
    const existing = await this.users.findOne({
      where: { email: input.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const freePlan = await this.plans.findOne({ where: { code: 'free' } });

    return this.sequelize.transaction(async (transaction) => {
      const user = await this.users.create(
        {
          email: input.email,
          passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
          firstName: input.firstName,
          lastName: input.lastName,
        },
        { transaction },
      );

      const tenant = await this.tenants.create(
        {
          name: input.organisationName,
          slug: await this.uniqueSlug(input.organisationName, transaction),
          status: TenantStatus.TRIALING,
          planId: freePlan?.id ?? null,
          billingEmail: input.email,
          // 14 days, then read-only - never deleted. Spec section 6.4.
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
        { transaction },
      );

      await this.memberships.create(
        {
          tenantId: tenant.id,
          userId: user.id,
          role: TenantRole.OWNER,
          status: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        },
        { transaction },
      );

      return { user, tenant };
    });
  }

  async login(input: LoginInput) {
    const user = await this.users.findOne({ where: { email: input.email } });

    // The password is compared even when no user was found, against a dummy
    // hash, so that "no such account" and "wrong password" take the same time.
    // Skipping it turns login into an endpoint that enumerates customers.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const ok = await bcrypt.compare(input.password, hash);

    if (!user || !ok || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = await this.memberships.findAll({
      where: { userId: user.id, status: MembershipStatus.ACTIVE },
      include: [Tenant],
    });

    if (memberships.length === 0) {
      // The successor to the Firebase app's "not linked to an organisation".
      throw new UnauthorizedException(
        'Your account is not linked to an organisation',
      );
    }

    await user.update({ lastLoginAt: new Date() });

    return this.issueTokens(user, memberships[0]);
  }

  /**
   * Re-issues an access token for a different tenant.
   *
   * The membership is re-read here rather than trusted from the old token: a
   * user removed from a tenant a minute ago must not be able to switch into it.
   */
  async switchTenant(userId: string, tenantId: string) {
    const membership = await this.memberships.findOne({
      where: { userId, tenantId, status: MembershipStatus.ACTIVE },
    });

    if (!membership) {
      // 401 rather than 404: whether that tenant exists is not this user's
      // business to learn.
      throw new UnauthorizedException('You are not a member of that tenant');
    }

    const user = await this.users.findByPk(userId);
    if (!user || !user.isActive) throw new UnauthorizedException();

    return this.issueTokens(user, membership);
  }

  async refresh(token: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Redis is the source of truth for whether a session is still live. A
    // signed but revoked token must not work, which a stateless check cannot do.
    const stored = await this.redis.get(sessionKey(payload.sub, payload.sid));
    if (!stored) throw new UnauthorizedException('Session has been revoked');

    const user = await this.users.findByPk(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException();

    const membership = await this.memberships.findOne({
      where: {
        userId: user.id,
        tenantId: stored,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (!membership) throw new UnauthorizedException('Membership is no longer active');

    // The old session id is dropped and a new one issued, so a refresh token
    // that leaks cannot be replayed after the real user has used it.
    await this.redis.del(sessionKey(payload.sub, payload.sid));

    return this.issueTokens(user, membership);
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.redis.del(sessionKey(userId, sessionId));
      return;
    }

    // No session id means log out everywhere.
    const keys = await this.redis.keys(sessionKey(userId, '*'));
    if (keys.length) await this.redis.del(...keys);
  }

  private async issueTokens(user: User, membership: Membership) {
    const sessionId = randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      tid: membership.tenantId,
      role: membership.role,
      prole: user.platformRole ?? PlatformRole.NONE,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: asDuration(
        this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      ),
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId } satisfies RefreshTokenPayload,
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: asDuration(
          this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
        ),
      },
    );

    // The Redis entry expires with the token, so revoked and expired sessions
    // clean themselves up instead of growing forever.
    await this.redis.set(
      sessionKey(user.id, sessionId),
      membership.tenantId,
      'EX',
      30 * 24 * 60 * 60,
    );

    return {
      accessToken,
      refreshToken,
      tenantId: membership.tenantId,
      role: membership.role,
    };
  }

  /** Slugs collide - two customers can both be called "Lanka Traders". */
  private async uniqueSlug(name: string, transaction: any): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'tenant';

    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i}`;
      const taken = await this.tenants.findOne({
        where: { slug: candidate },
        transaction,
      });
      if (!taken) return candidate;
    }

    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}

const sessionKey = (userId: string, sessionId: string) =>
  `session:${userId}:${sessionId}`;

// A real bcrypt hash of a value nobody knows, used to keep the timing of a
// failed login independent of whether the account exists.
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7pGZQ8ZKvJZ7HqZ9wVnJ8ZKvJZ7HqZO';
