// tenant.model.ts is the customer organisation - the successor to the single
// `orgs/{orgId}` document of the Firebase app.
//
// Not tenant-scoped itself: this IS the tenant.
import {
  Column, CreatedAt, DataType, Default, DeletedAt, HasMany,
  Model, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantStatus } from '../../../common/constants/roles';
import { Membership } from './membership.model';

@Table({ tableName: 'tenants', paranoid: true })
export class Tenant extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  // Their login hint and future subdomain. Lower-cased on write.
  @Column({ type: DataType.STRING(63), allowNull: false, unique: true })
  declare slug: string;

  @Default(TenantStatus.TRIALING)
  @Column(DataType.ENUM(...Object.values(TenantStatus)))
  declare status: TenantStatus;

  @Column({ type: DataType.UUID, allowNull: true })
  declare planId: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare trialEndsAt: Date | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare billingEmail: string | null;

  @Default('LK')
  @Column(DataType.STRING(2))
  declare country: string;

  @Default('LKR')
  @Column(DataType.STRING(3))
  declare currency: string;

  // Holds limitOverrides for the founding-customer discount, so that case is a
  // row value rather than an `if (tenant.name === ...)` in the quota guard.
  @Default({})
  @Column(DataType.JSONB)
  declare settings: Record<string, unknown>;

  @HasMany(() => Membership)
  declare memberships: Membership[];

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
  @DeletedAt declare deletedAt: Date | null;
}
