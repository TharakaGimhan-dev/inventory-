'use strict';

// Phase 1 schema: tenants, plans, users, memberships.
//
// Every constraint here is the FIRST isolation layer of spec section 3.1. The
// composite unique keys matter most: UNIQUE(userId) alone would stop a person
// belonging to two tenants, and UNIQUE(code) alone would stop two customers
// both owning asset TS-0001.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, BOOLEAN, DATE, JSONB, INTEGER, DECIMAL, ENUM } =
      Sequelize;

    await queryInterface.createTable('plans', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      code: { type: STRING(32), allowNull: false, unique: true },
      name: { type: STRING(80), allowNull: false },
      priceMonthly: { type: DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      priceYearly: { type: DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: STRING(3), allowNull: false, defaultValue: 'LKR' },
      limits: { type: JSONB, allowNull: false },
      features: { type: JSONB, allowNull: false, defaultValue: {} },
      isPublic: { type: BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('tenants', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      name: { type: STRING(120), allowNull: false },
      slug: { type: STRING(63), allowNull: false, unique: true },
      status: {
        type: ENUM('trialing', 'active', 'past_due', 'suspended', 'cancelled'),
        allowNull: false,
        defaultValue: 'trialing',
      },
      planId: {
        type: UUID,
        allowNull: true,
        references: { model: 'plans', key: 'id' },
        // A plan must not be deletable out from under a paying tenant.
        onDelete: 'RESTRICT',
      },
      trialEndsAt: { type: DATE, allowNull: true },
      billingEmail: { type: STRING, allowNull: true },
      country: { type: STRING(2), allowNull: false, defaultValue: 'LK' },
      currency: { type: STRING(3), allowNull: false, defaultValue: 'LKR' },
      settings: { type: JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
      deletedAt: { type: DATE, allowNull: true },
    });

    await queryInterface.createTable('users', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      // CITEXT from the extensions migration: case-insensitive, so one person
      // cannot end up with two accounts differing only in capitalisation.
      email: { type: 'CITEXT', allowNull: false, unique: true },
      passwordHash: { type: STRING, allowNull: false },
      firstName: { type: STRING(80), allowNull: false },
      lastName: { type: STRING(80), allowNull: false },
      platformRole: {
        type: ENUM('none', 'support', 'superadmin'),
        allowNull: false,
        defaultValue: 'none',
      },
      emailVerified: { type: BOOLEAN, allowNull: false, defaultValue: false },
      isActive: { type: BOOLEAN, allowNull: false, defaultValue: true },
      lastLoginAt: { type: DATE, allowNull: true },
      tokensValidFrom: { type: DATE, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    await queryInterface.createTable('memberships', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      tenantId: {
        type: UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        // Deleting a tenant removes its memberships but never the users - the
        // people keep their accounts and any other tenant they belong to.
        onDelete: 'CASCADE',
      },
      userId: {
        type: UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      role: {
        type: ENUM('owner', 'admin', 'entry', 'viewer'),
        allowNull: false,
        defaultValue: 'viewer',
      },
      status: {
        type: ENUM('invited', 'active', 'disabled'),
        allowNull: false,
        defaultValue: 'active',
      },
      invitedBy: { type: UUID, allowNull: true },
      joinedAt: { type: DATE, allowNull: true },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });

    // Composite, not UNIQUE(userId): one person, many tenants.
    await queryInterface.addIndex('memberships', ['tenantId', 'userId'], {
      unique: true,
      name: 'memberships_tenant_user_unique',
    });

    // Login reads a user's memberships before any tenant is known.
    await queryInterface.addIndex('memberships', ['userId'], {
      name: 'memberships_user_idx',
    });

    await queryInterface.addIndex('tenants', ['status'], {
      name: 'tenants_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('memberships');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('tenants');
    await queryInterface.dropTable('plans');

    // Sequelize creates a Postgres type per ENUM column and does not drop them
    // with the table, so a re-run of `up` would fail on "type already exists".
    for (const type of [
      'enum_tenants_status',
      'enum_users_platformRole',
      'enum_memberships_role',
      'enum_memberships_status',
    ]) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${type}";`);
    }
  },
};
