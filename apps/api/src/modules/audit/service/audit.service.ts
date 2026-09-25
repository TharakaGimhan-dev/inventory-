// audit.service.ts writes the append-only trail.
//
// Every write in the register goes through here, inside the caller's
// transaction: if the change rolls back, so does its audit entry, and the trail
// never claims something happened that did not.
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { AuditAction } from '../../../common/constants/asset';
import { AuditEntry } from '../models/audit-entry.model';

export type AuditInput = {
  actorUserId: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
};

// Never recorded, in before or after. An audit trail that copies secrets is a
// second place they can leak from.
const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'secret',
]);

// Excluded from a diff. updatedAt changes on every save, so including it would
// put a meaningless entry in the trail for a save that changed nothing real,
// and bury the one field that did move.
const IGNORED_IN_DIFF = new Set(['updatedAt', 'createdAt']);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditEntry) private readonly entries: typeof AuditEntry,
  ) {}

  async record(input: AuditInput, transaction: Transaction) {
    return this.entries.create(
      {
        actorUserId: input.actorUserId,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        before: redact(input.before),
        after: redact(input.after),
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      } as any,
      { transaction },
    );
  }

  /**
   * The changed fields only, as { before, after }.
   *
   * Storing whole rows would copy an unchanged description into every entry and
   * bury the one field that actually moved.
   */
  diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): { before: Record<string, unknown>; after: Record<string, unknown> } {
    const b: Record<string, unknown> = {};
    const a: Record<string, unknown> = {};

    for (const key of Object.keys(after)) {
      if (IGNORED_IN_DIFF.has(key)) continue;

      // Compared as JSON so that a Date and an equal Date, or two equal arrays,
      // do not register as a change on every save.
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        b[key] = before[key];
        a[key] = after[key];
      }
    }

    return { before: b, after: a };
  }
}

function redact(value?: Record<string, unknown> | null) {
  if (!value) return null;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : v;
  }
  return out;
}
