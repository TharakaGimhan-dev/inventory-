// webhook-event.model.ts records every provider callback we have already
// processed.
//
// Payment providers retry. PayHere resends a notification it did not get a 200
// for, and a retry that is processed twice extends a subscription twice or
// writes a second invoice for one payment. The unique index is what makes
// processing exactly-once: the insert fails on the second copy, and that
// failure is the signal to stop.
import {
  Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table,
} from 'sequelize-typescript';

@Table({
  tableName: 'webhook_events',
  updatedAt: false,
  indexes: [{ unique: true, fields: ['provider', 'eventId'] }],
})
export class WebhookEvent extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare provider: string;

  /** The provider's id for this delivery. */
  @Column({ type: DataType.STRING(160), allowNull: false })
  declare eventId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare tenantId: string | null;

  // The raw body, kept so a dispute can be settled against what they actually
  // sent rather than what we believed they sent.
  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: Record<string, unknown>;

  @Column({ type: DataType.STRING(40), allowNull: true })
  declare outcome: string | null;

  @CreatedAt declare createdAt: Date;
}
