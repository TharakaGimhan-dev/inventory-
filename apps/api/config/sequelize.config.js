// sequelize.config.js is read by sequelize-cli only - the running app configures
// itself through database.module.ts instead. The CLI cannot load the Nest config,
// so the connection string is read straight from the environment here.
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Locally, copy .env.example to .env. ' +
      'On Railway, set it to ${{Postgres.DATABASE_URL}}.',
  );
}

const base = {
  url: process.env.DATABASE_URL,
  dialect: 'postgres',
  migrationStorageTableName: 'sequelize_meta',
};

// Railway's managed Postgres presents a certificate for an internal hostname, so
// the chain cannot be verified even though the connection is encrypted.
const productionSsl = {
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
};

module.exports = {
  development: base,
  test: base,
  production: { ...base, ...productionSsl },
};
