'use strict';

// Phase 6 schema: API keys.
//
// Custom field definitions need no table - they live in tenants.settings, so
// an organisation adding a field is a settings change rather than a migration.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, DATE, ENUM } = Sequelize;

    await queryInterface.createTable('api_keys', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: {
        type: UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: STRING(80), allowNull: false },
      // SHA-256 hex of the key. The key itself is never stored, so a leak of
      // this table hands nobody a working credential.
      keyHash: { type: STRING(64), allowNull: false },
      // The first characters, in clear, so a customer can tell four keys apart.
      prefix: { type: STRING(16), allowNull: false },
      // Never owner or admin: an unattended credential must not be able to
      // delete the register or change billing.
      role: { type: ENUM('viewer', 'entry'), allowNull: false, defaultValue: 'viewer' },
      createdByUserId: {
        type: UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      lastUsedAt: { type: DATE, allowNull: true },
      // Revoked, not deleted: the audit trail refers to it.
      revokedAt: { type: DATE, allowNull: true },
      expiresAt: { type: DATE, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    // Unique and global, not per tenant: authentication looks a key up before
    // it knows which tenant the request belongs to.
    await queryInterface.addIndex('api_keys', ['keyHash'], {
      unique: true,
      name: 'api_keys_hash_unique',
    });

    await queryInterface.addIndex('api_keys', ['tenantId', 'revokedAt'], {
      name: 'api_keys_tenant_revoked_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('api_keys');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_api_keys_role";');
  },
};
