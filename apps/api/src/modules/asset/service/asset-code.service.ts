// asset-code.service.ts issues the next asset code for a tenant.
//
// Three properties have to hold, and they are the reason this is not a simple
// SELECT MAX(code) + 1:
//
//   unique       - two people capturing at the same moment must not both get TS-0007
//   gapless      - the register is read as a sequence by the people using it
//   never reused - a code has been printed on a label and stuck to equipment,
//                  so reissuing it makes the label point at two things
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { getCurrentTenantId } from '../../../common/context/tenant.context';

export const ASSET_CODE_KEY = 'assetCode';

@Injectable()
export class AssetCodeService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Returns the next code, e.g. TS-0007.
   *
   * MUST be called inside the same transaction as the asset insert. If the
   * insert then fails, the increment rolls back with it and the code goes to
   * the next capture instead of leaving a hole in the sequence.
   */
  async next(transaction: Transaction, prefix = 'TS'): Promise<string> {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      throw new Error('Cannot issue an asset code with no tenant in context');
    }

    // One statement, not a read followed by a write.
    //
    // INSERT ... ON CONFLICT DO UPDATE is atomic: Postgres takes the row lock
    // itself, so two concurrent captures are serialised by the database and the
    // second one returns the incremented value. The read-then-write shape
    // (findOrCreate, or SELECT then UPDATE) has a window between the two where
    // both transactions see the same number.
    const rows = await this.sequelize.query<{ value: number }>(
      `INSERT INTO counters ("id", "tenantId", "key", "value", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :tenantId, :key, 1, NOW(), NOW())
       ON CONFLICT ("tenantId", "key")
       DO UPDATE SET "value" = counters."value" + 1, "updatedAt" = NOW()
       RETURNING "value"`,
      {
        replacements: { tenantId, key: ASSET_CODE_KEY },
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    const value = rows[0]?.value;
    if (typeof value !== 'number') {
      throw new Error('Asset code counter did not return a value');
    }

    // Padded to 4 so codes sort as text and fit a label. Past 9999 it simply
    // grows - TS-10000 is fine, and the alternatives (reuse, renumbering) are
    // the one thing forbidden.
    return `${prefix}-${String(value).padStart(4, '0')}`;
  }
}
