// audit-entry.model.ts is the append-only record of who changed what.
//
// There is no update route and no delete route, at any role - spec section 11.1
// case 11, carried over from the Firebase rules. The model hooks below make that
// true even for code that bypasses the controllers, so a tenant admin cannot
// quietly erase the record of their own edit.
import {
  BeforeBulkDestroy, BeforeBulkUpdate, BeforeDestroy, BeforeUpdate,
  Column, CreatedAt, DataType, Default, ForeignKey, PrimaryKey, Table,
} from 'sequelize-typescript';
import { AuditAction } from '../../../common/constants/asset';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';

export class AuditEntryImmutableError extends Error {
  constructor(operation: string) {
    super(
      `Audit entries are append-only; ${operation} is not permitted. ` +
        `If a record is wrong, write a correcting entry instead.`,
    );
    this.name = 'AuditEntryImmutableError';
  }
}

@Table({
  tableName: 'audit_entries',
  updatedAt: false,
  indexes: [
    { fields: ['tenantId', 'createdAt'] },
    { fields: ['tenantId', 'entity', 'entityId'] },
  ],
})
export class AuditEntry extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare actorUserId: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare entity: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare entityId: string;

  @Column(DataType.ENUM(...Object.values(AuditAction)))
  declare action: AuditAction;

  // Only the fields that changed, not the whole row: a diff stays readable and
  // does not copy the same unchanged description into every entry.
  @Column({ type: DataType.JSONB, allowNull: true })
  declare before: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare after: Record<string, unknown> | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  declare ip: string | null;

  @Column({ type: DataType.STRING(300), allowNull: true })
  declare userAgent: string | null;

  @CreatedAt declare createdAt: Date;

  @BeforeUpdate
  @BeforeBulkUpdate
  static refuseUpdate() {
    throw new AuditEntryImmutableError('update');
  }

  @BeforeDestroy
  @BeforeBulkDestroy
  static refuseDestroy() {
    throw new AuditEntryImmutableError('delete');
  }
}
