'use strict';

// Seeds the price list from spec section 6.1.
//
// Idempotent: re-running updates limits rather than inserting duplicates, so
// changing a tier is a re-seed and never a manual UPDATE in production.
const { randomUUID } = require('node:crypto');

const MB = 1024 * 1024;

const PLANS = [
  {
    code: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    sortOrder: 0,
    limits: {
      assets: 100, members: 2, locations: 5, photosPerAsset: 1,
      storageBytes: 200 * MB, auditRetentionDays: 30, customFields: 0,
    },
    features: { csvExport: true, reports: false, labels: false, api: false },
  },
  {
    code: 'starter',
    name: 'Starter',
    priceMonthly: 2500,
    priceYearly: 25000,
    sortOrder: 1,
    limits: {
      assets: 1000, members: 10, locations: -1, photosPerAsset: 5,
      storageBytes: 5 * 1024 * MB, auditRetentionDays: 365, customFields: 5,
    },
    features: { csvExport: true, reports: true, labels: true, api: false },
  },
  {
    code: 'business',
    name: 'Business',
    priceMonthly: 7500,
    priceYearly: 75000,
    sortOrder: 2,
    limits: {
      // -1 is unlimited.
      assets: -1, members: -1, locations: -1, photosPerAsset: 10,
      storageBytes: 25 * 1024 * MB, auditRetentionDays: -1, customFields: -1,
    },
    features: { csvExport: true, reports: true, labels: true, api: true },
  },
];

module.exports = {
  async up(queryInterface) {
    for (const plan of PLANS) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM plans WHERE code = :code',
        { replacements: { code: plan.code }, type: 'SELECT' },
      );

      const row = {
        ...plan,
        limits: JSON.stringify(plan.limits),
        features: JSON.stringify(plan.features),
        currency: 'LKR',
        isPublic: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await queryInterface.bulkUpdate('plans', row, { code: plan.code });
      } else {
        await queryInterface.bulkInsert('plans', [
          { id: randomUUID(), ...row, createdAt: new Date() },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('plans', {
      code: PLANS.map((p) => p.code),
    });
  },
};
