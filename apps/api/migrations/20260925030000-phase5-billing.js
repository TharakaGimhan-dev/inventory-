'use strict';

// Phase 5 schema: subscriptions, invoices, and the record of every provider
// callback already processed.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, BOOLEAN, DATE, JSONB, INTEGER, DECIMAL, ENUM } =
      Sequelize;

    await queryInterface.createTable('subscriptions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: {
        type: UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      planId: {
        type: UUID,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        // A plan must not be deletable while someone is paying for it.
        onDelete: 'RESTRICT',
      },
      status: {
        type: ENUM('pending', 'active', 'past_due', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      provider: { type: ENUM('payhere', 'manual'), allowNull: false },
      // Null between checkout and the first webhook: PayHere only issues its
      // own id once a payment clears.
      providerRef: { type: STRING(120), allowNull: true },
      amount: { type: DECIMAL(10, 2), allowNull: false },
      currency: { type: STRING(3), allowNull: false, defaultValue: 'LKR' },
      currentPeriodStart: { type: DATE, allowNull: true },
      currentPeriodEnd: { type: DATE, allowNull: true },
      cancelAtPeriodEnd: { type: BOOLEAN, allowNull: false, defaultValue: false },
      cancelledAt: { type: DATE, allowNull: true },
      pastDueSince: { type: DATE, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('invoices', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: {
        type: UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        // RESTRICT, not CASCADE: a paid invoice is an accounting record and
        // must not disappear because a tenant row was removed.
        onDelete: 'RESTRICT',
      },
      subscriptionId: {
        type: UUID,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'SET NULL',
      },
      number: { type: STRING(32), allowNull: false, unique: true },
      status: {
        type: ENUM('open', 'paid', 'failed', 'void', 'refunded'),
        allowNull: false,
        defaultValue: 'open',
      },
      amount: { type: DECIMAL(10, 2), allowNull: false },
      currency: { type: STRING(3), allowNull: false, defaultValue: 'LKR' },
      providerRef: { type: STRING(120), allowNull: true },
      paidAt: { type: DATE, allowNull: true },
      note: { type: TEXT, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    // A single-row table holding the global invoice sequence. Accounting reads
    // one continuous series, so this is not per tenant.
    await queryInterface.createTable('invoice_counter', {
      id: { type: INTEGER, primaryKey: true },
      value: { type: INTEGER, allowNull: false, defaultValue: 0 },
    });

    await queryInterface.createTable('webhook_events', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      provider: { type: STRING(32), allowNull: false },
      eventId: { type: STRING(160), allowNull: false },
      tenantId: { type: UUID, allowNull: true },
      payload: { type: JSONB, allowNull: false },
      outcome: { type: STRING(40), allowNull: true },
      createdAt: { type: DATE, allowNull: false },
    });

    // This index is the exactly-once guarantee. Providers retry, and a retry
    // processed twice extends a subscription twice or writes a second invoice
    // for one payment. The insert failing is the signal to stop.
    await queryInterface.addIndex('webhook_events', ['provider', 'eventId'], {
      unique: true,
      name: 'webhook_events_provider_event_unique',
    });

    await queryInterface.addIndex('subscriptions', ['tenantId', 'status'], {
      name: 'subscriptions_tenant_status_idx',
    });
    await queryInterface.addIndex('subscriptions', ['providerRef'], {
      name: 'subscriptions_provider_ref_idx',
    });
    await queryInterface.addIndex('invoices', ['tenantId', 'createdAt'], {
      name: 'invoices_tenant_created_idx',
    });
  },

  async down(queryInterface) {
    for (const table of ['webhook_events', 'invoice_counter', 'invoices', 'subscriptions']) {
      await queryInterface.dropTable(table);
    }

    for (const type of [
      'enum_subscriptions_status',
      'enum_subscriptions_provider',
      'enum_invoices_status',
    ]) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${type}";`);
    }
  },
};
