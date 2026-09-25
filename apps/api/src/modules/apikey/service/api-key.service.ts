// api-key.service.ts issues and checks API keys.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash, randomBytes } from 'node:crypto';
import { runWithoutTenantScope } from '../../../common/context/tenant.context';
import { TenantRole } from '../../../common/constants/roles';
import { ApiKey } from '../models/api-key.model';

const PREFIX = 'tsk_';

/** SHA-256 hex. See the note in the model for why not bcrypt. */
const hash = (key: string) =>
  createHash('sha256').update(key).digest('hex');

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(@InjectModel(ApiKey) private readonly keys: typeof ApiKey) {}

  /**
   * Creates a key and returns it **once**.
   *
   * The plaintext is never stored and cannot be shown again. Saying so at the
   * moment of creation is the difference between a customer who saves it and
   * one who comes back tomorrow asking for it.
   */
  async create(name: string, role: TenantRole, userId: string) {
    // 32 bytes from the CSPRNG. Anything derived from a timestamp or a uuid v4
    // is guessable in ways this is not.
    const secret = randomBytes(32).toString('base64url');
    const key = `${PREFIX}${secret}`;

    const record = await this.keys.create({
      name,
      role,
      keyHash: hash(key),
      prefix: key.slice(0, 12),
      createdByUserId: userId,
    } as any);

    return {
      id: record.id,
      name: record.name,
      role: record.role,
      prefix: record.prefix,
      createdAt: record.createdAt,
      key,
      warning: 'Copy this key now. It is not stored and cannot be shown again.',
    };
  }

  list() {
    return this.keys.findAll({
      attributes: ['id', 'name', 'role', 'prefix', 'lastUsedAt', 'revokedAt', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
  }

  async revoke(id: string) {
    const key = await this.keys.findByPk(id);
    if (!key) throw new NotFoundException('API key not found');

    await key.update({ revokedAt: new Date() });
    return { revoked: true };
  }

  /**
   * Looks a key up for authentication.
   *
   * Runs outside tenant scope by necessity: the request has no tenant yet -
   * finding out which tenant it belongs to is the whole point of this call.
   * The lookup is by hash, so it can only ever match one row.
   */
  async verify(presented: string) {
    if (!presented.startsWith(PREFIX)) return null;

    const record = await runWithoutTenantScope(() =>
      this.keys.findOne({ where: { keyHash: hash(presented) } }),
    );

    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // Inside the bypass, like the lookup above: authentication happens before
    // any tenant is in context, so a scoped write here would throw. It is
    // best-effort - a customer checking which keys are still live should not
    // lose their request because that write failed - but it must actually run,
    // and a bare .catch() hid the fact that it never did.
    void runWithoutTenantScope(() =>
      record
        .update({ lastUsedAt: new Date() })
        .catch((error) =>
          this.logger.warn(
            `Could not record last use of API key ${record.prefix}: ${error.message}`,
          ),
        ),
    );

    return record;
  }
}
