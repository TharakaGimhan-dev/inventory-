// membership.model.ts joins a user to a tenant and carries their role there.
// Successor to `orgs/{orgId}/members/{uid}` from the Firebase app.
//
// Not tenant-scoped in the hook sense: login has to read a user's memberships
// BEFORE a tenant is known, which is exactly the chicken-and-egg the hook would
// break. Every read here is explicitly filtered by userId or tenantId instead.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey,
  Model, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { MembershipStatus, TenantRole } from '../../../common/constants/roles';
import { User } from '../../user/models/user.model';
import { Tenant } from './tenant.model';

@Table({
  tableName: 'memberships',
  indexes: [
    // Composite, never UNIQUE(userId) alone - the same person must be able to
    // hold a membership in more than one tenant.
    { unique: true, fields: ['tenantId', 'userId'] },
  ],
})
export class Membership extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Tenant)
  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @BelongsTo(() => Tenant)
  declare tenant: Tenant;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string;

  @BelongsTo(() => User)
  declare user: User;

  @Default(TenantRole.VIEWER)
  @Column(DataType.ENUM(...Object.values(TenantRole)))
  declare role: TenantRole;

  @Default(MembershipStatus.ACTIVE)
  @Column(DataType.ENUM(...Object.values(MembershipStatus)))
  declare status: MembershipStatus;

  @Column({ type: DataType.UUID, allowNull: true })
  declare invitedBy: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare joinedAt: Date | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
