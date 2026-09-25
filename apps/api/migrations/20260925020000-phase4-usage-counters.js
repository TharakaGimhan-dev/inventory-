'use strict';

// Phase 4 schema: the metered numbers the quota guard compares against a plan.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, DATE, BIGINT } = Sequelize;

    await queryInterface.createTable('usage_counters', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: {
        type: UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      metric: { type: STRING(32), allowNull: false },
      // 'current' for a present state (how many assets exist), or YYYY-MM for a
      // metric that accumulates within a month.
      period: { type: STRING(16), allowNull: false, defaultValue: 'current' },
      // BIGINT: storage_bytes outgrows INTEGER at 2GB and a plan sells 25.
      value: { type: BIGINT, allowNull: false, defaultValue: 0 },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    // The unique key is what makes the INSERT ... ON CONFLICT increment atomic.
    await queryInterface.addIndex(
      'usage_counters',
      ['tenantId', 'metric', 'period'],
      { unique: true, name: 'usage_counters_tenant_metric_period_unique' },
    );

    // Backfill from the source tables. Without this every tenant that existed
    // before this migration starts at zero usage and can exceed its plan by
    // exactly as much as it already holds.
    await queryInterface.sequelize.query(`
      INSERT INTO usage_counters ("id","tenantId","metric","period","value","createdAt","updatedAt")
      SELECT gen_random_uuid(), t.id, m.metric, 'current', m.value, NOW(), NOW()
      FROM tenants t
      CROSS JOIN LATERAL (
        VALUES
          ('assets',    (SELECT COUNT(*) FROM assets      a WHERE a."tenantId" = t.id AND a."deletedAt" IS NULL)),
          ('locations', (SELECT COUNT(*) FROM locations   l WHERE l."tenantId" = t.id AND l."isActive" = true)),
          ('members',   (SELECT COUNT(*) FROM memberships s WHERE s."tenantId" = t.id AND s."status" = 'active'))
      ) AS m(metric, value)
      ON CONFLICT ("tenantId","metric","period") DO NOTHING;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('usage_counters');
  },
};
