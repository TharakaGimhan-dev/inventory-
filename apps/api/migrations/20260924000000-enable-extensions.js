'use strict';

// The first migration exists to prove the migration pipeline works end to end
// before any table depends on it, and to install the extensions every later
// migration assumes are present.
module.exports = {
  async up(queryInterface) {
    // pgcrypto provides gen_random_uuid(), used as the default for every primary
    // key. Generating ids in the database means a row is never written without
    // one, even by a migration or a manual insert.
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto";',
    );

    // citext gives case-insensitive columns. Email uniqueness depends on it:
    // without it Tharaka@x.lk and tharaka@x.lk are two different accounts.
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "citext";',
    );
  },

  async down(queryInterface) {
    // Deliberately not dropped. Another schema in the same database may rely on
    // them, and dropping an extension cascades to every column using its types.
    await queryInterface.sequelize.query('SELECT 1;');
  },
};
