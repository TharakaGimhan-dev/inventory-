// user.model.ts is a person, global across tenants.
//
// Deliberately NOT tenant-scoped. One person may belong to two tenants - their
// own company and a client's - and must not need two passwords for that. What
// they may DO is on the membership, not here.
import {
  Column, CreatedAt, DataType, Default, HasMany,
  Model, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { PlatformRole } from '../../../common/constants/roles';
import { Membership } from '../../tenant/models/membership.model';

@Table({ tableName: 'users' })
export class User extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  // CITEXT, so Tharaka@x.lk and tharaka@x.lk are the same account rather than
  // two accounts one of which can never be logged into.
  @Column({ type: 'CITEXT', allowNull: false, unique: true })
  declare email: string;

  // The hash only. The plain password is never stored, logged or returned.
  @Column({ type: DataType.STRING, allowNull: false })
  declare passwordHash: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare firstName: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare lastName: string;

  // Our own staff axis, unrelated to what they can do inside any tenant.
  @Default(PlatformRole.NONE)
  @Column(DataType.ENUM(...Object.values(PlatformRole)))
  declare platformRole: PlatformRole;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare emailVerified: boolean;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare lastLoginAt: Date | null;

  // Every refresh token issued before this moment is rejected. Set on password
  // change, so changing a password logs out the stolen session too.
  @Column({ type: DataType.DATE, allowNull: true })
  declare tokensValidFrom: Date | null;

  @HasMany(() => Membership)
  declare memberships: Membership[];

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
