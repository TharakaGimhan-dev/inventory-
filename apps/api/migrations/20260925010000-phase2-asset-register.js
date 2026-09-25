'use strict';

// Phase 2 schema: the register itself.
//
// Every table here is tenant-owned, so every one carries tenantId NOT NULL and
// every unique constraint is composite with it. UNIQUE(code) alone would stop a
// second customer from ever owning TS-0001.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, BOOLEAN, DATE, DATEONLY, JSONB, INTEGER, DECIMAL, ENUM } =
      Sequelize;

    const tenantRef = {
      type: UUID,
      allowNull: false,
      references: { model: 'tenants', key: 'id' },
      onDelete: 'CASCADE',
    };

    await queryInterface.createTable('locations', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      name: { type: STRING(120), allowNull: false },
      parentId: {
        type: UUID,
        allowNull: true,
        references: { model: 'locations', key: 'id' },
        // A floor must not be deletable while its rooms still point at it.
        onDelete: 'RESTRICT',
      },
      code: { type: STRING(32), allowNull: true },
      isActive: { type: BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('categories', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      name: { type: STRING(120), allowNull: false },
      parentId: {
        type: UUID,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onDelete: 'RESTRICT',
      },
      defaultUsefulLifeMonths: { type: INTEGER, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('counters', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      key: { type: STRING(40), allowNull: false },
      value: { type: INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('assets', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      code: { type: STRING(32), allowNull: false },
      kind: {
        type: ENUM('asset', 'consumable'),
        allowNull: false,
        defaultValue: 'asset',
      },
      name: { type: STRING(160), allowNull: false },
      description: { type: TEXT, allowNull: true },
      categoryId: {
        type: UUID,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onDelete: 'SET NULL',
      },
      locationId: {
        type: UUID,
        allowNull: true,
        references: { model: 'locations', key: 'id' },
        onDelete: 'SET NULL',
      },
      assignedToUserId: { type: UUID, allowNull: true },
      serialNumber: { type: STRING(120), allowNull: true },
      status: {
        type: ENUM('in_use', 'in_store', 'repair', 'written_off', 'disposed'),
        allowNull: false,
        defaultValue: 'in_use',
      },
      condition: {
        type: ENUM('new', 'good', 'fair', 'poor'),
        allowNull: false,
        defaultValue: 'good',
      },
      purchaseDate: { type: DATEONLY, allowNull: true },
      // DECIMAL, never FLOAT - these columns end up in an insurance valuation.
      purchasePrice: { type: DECIMAL(12, 2), allowNull: true },
      replacementValue: { type: DECIMAL(12, 2), allowNull: true },
      supplier: { type: STRING(160), allowNull: true },
      warrantyEndsAt: { type: DATEONLY, allowNull: true },
      quantity: { type: INTEGER, allowNull: false, defaultValue: 1 },
      imageIds: { type: JSONB, allowNull: false, defaultValue: [] },
      customFields: { type: JSONB, allowNull: false, defaultValue: {} },
      createdByUserId: { type: UUID, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
      deletedAt: { type: DATE, allowNull: true },
    });

    await queryInterface.createTable('asset_movements', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      assetId: {
        type: UUID,
        allowNull: false,
        references: { model: 'assets', key: 'id' },
        onDelete: 'CASCADE',
      },
      fromLocationId: { type: UUID, allowNull: true },
      toLocationId: { type: UUID, allowNull: true },
      fromUserId: { type: UUID, allowNull: true },
      toUserId: { type: UUID, allowNull: true },
      movedByUserId: { type: UUID, allowNull: false },
      note: { type: TEXT, allowNull: true },
      movedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('audit_entries', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: tenantRef,
      actorUserId: { type: UUID, allowNull: true },
      entity: { type: STRING(40), allowNull: false },
      entityId: { type: UUID, allowNull: false },
      action: {
        type: ENUM('create', 'update', 'delete', 'move', 'export'),
        allowNull: false,
      },
      before: { type: JSONB, allowNull: true },
      after: { type: JSONB, allowNull: true },
      ip: { type: STRING(64), allowNull: true },
      userAgent: { type: STRING(300), allowNull: true },
      createdAt: { type: DATE, allowNull: false },
    });

    // Composite with tenantId, so two customers can both hold TS-0001.
    await queryInterface.addIndex('assets', ['tenantId', 'code'], {
      unique: true,
      name: 'assets_tenant_code_unique',
    });

    // One counter row per tenant per key. The unique index is what makes
    // findOrCreate safe under concurrency.
    await queryInterface.addIndex('counters', ['tenantId', 'key'], {
      unique: true,
      name: 'counters_tenant_key_unique',
    });

    await queryInterface.addIndex('locations', ['tenantId', 'name', 'parentId'], {
      unique: true,
      name: 'locations_tenant_name_parent_unique',
    });

    await queryInterface.addIndex('categories', ['tenantId', 'name'], {
      unique: true,
      name: 'categories_tenant_name_unique',
    });

    // Every list query filters by tenantId first, so it leads each index.
    for (const [table, fields, name] of [
      ['assets', ['tenantId', 'status'], 'assets_tenant_status_idx'],
      ['assets', ['tenantId', 'locationId'], 'assets_tenant_location_idx'],
      ['assets', ['tenantId', 'categoryId'], 'assets_tenant_category_idx'],
      ['asset_movements', ['tenantId', 'assetId'], 'asset_movements_tenant_asset_idx'],
      ['audit_entries', ['tenantId', 'createdAt'], 'audit_tenant_created_idx'],
      ['audit_entries', ['tenantId', 'entity', 'entityId'], 'audit_tenant_entity_idx'],
    ]) {
      await queryInterface.addIndex(table, fields, { name });
    }
  },

  async down(queryInterface) {
    // Reverse creation order, so a foreign key never outlives its target.
    for (const table of [
      'audit_entries', 'asset_movements', 'assets',
      'counters', 'categories', 'locations',
    ]) {
      await queryInterface.dropTable(table);
    }

    // Sequelize leaves the Postgres type behind when the table goes, and a
    // re-run of up() would then fail on "type already exists".
    for (const type of [
      'enum_assets_kind', 'enum_assets_status', 'enum_assets_condition',
      'enum_audit_entries_action',
    ]) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${type}";`);
    }
  },
};
