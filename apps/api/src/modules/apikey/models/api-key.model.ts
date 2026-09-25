// api-key.model.ts lets a customer's own systems read the register.
//
// The key itself is never stored. Only a SHA-256 hash is kept, so a leak of
// this table does not hand anyone working keys - the same reason a password
// column holds a bcrypt hash.
//
// SHA-256 rather than bcrypt here on purpose: a key is 32 random bytes we
// generated, not a human-chosen password, so there is nothing to brute-force
// and the check happens on every API request where bcrypt's cost would be felt.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantRole } from '../../../common/constants/roles';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';
import { User } from '../../user/models/user.model';

@Table({
  tableName: 'api_keys',
  indexes: [
    { unique: true, fields: ['keyHash'] },
    { fields: ['tenantId', 'revokedAt'] },
  ],
})
export class ApiKey extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare keyHash: string;

  /**
   * The first characters of the key, kept in clear.
   *
   * So the customer can tell which of four keys is which in the list. Too
   * short to be useful to anyone who steals it.
   */
  @Column({ type: DataType.STRING(16), allowNull: false })
  declare prefix: string;

  /**
   * A key can never do more than the role it was created with, and never more
   * than viewer or entry - an unattended credential should not be able to
   * delete the register or change billing.
   */
  @Default(TenantRole.VIEWER)
  @Column(DataType.ENUM(TenantRole.VIEWER, TenantRole.ENTRY))
  declare role: TenantRole;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare createdByUserId: string | null;

  @BelongsTo(() => User)
  declare createdBy: User;

  @Column({ type: DataType.DATE, allowNull: true })
  declare lastUsedAt: Date | null;

  // Revoked, not deleted: the audit trail refers to it, and "when did this key
  // stop working" is a question worth being able to answer.
  @Column({ type: DataType.DATE, allowNull: true })
  declare revokedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare expiresAt: Date | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
