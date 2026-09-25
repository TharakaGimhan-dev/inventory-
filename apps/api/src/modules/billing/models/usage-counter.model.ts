// usage-counter.model.ts is the number the quota guard compares against a plan
// limit.
//
// A maintained counter rather than a COUNT(*) on every write: counting a
// million assets to decide whether a tenant may add one more is a query that
// gets slower exactly as the customer gets more valuable. The trade is that a
// counter can drift, so a nightly job recounts from the source tables - see
// UsageService.reconcile.
import {
  Column, CreatedAt, DataType, Default, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';

/**
 * What is metered.
 *
 * `period` is 'current' for the ones that describe a present state (how many
 * assets exist right now) and a YYYY-MM string for the ones that accumulate
 * within a month.
 */
export enum UsageMetric {
  ASSETS = 'assets',
  MEMBERS = 'members',
  LOCATIONS = 'locations',
  STORAGE_BYTES = 'storage_bytes',
  EXPORTS = 'exports',
}

export const CURRENT_PERIOD = 'current';

@Table({
  tableName: 'usage_counters',
  indexes: [{ unique: true, fields: ['tenantId', 'metric', 'period'] }],
})
export class UsageCounter extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare metric: UsageMetric;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare period: string;

  // BIGINT because storage_bytes outgrows INTEGER at 2GB, and a plan sells 25.
  @Default(0)
  @Column(DataType.BIGINT)
  declare value: string;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
