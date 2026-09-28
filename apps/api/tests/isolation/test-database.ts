// test-database.ts is the one place the suites get their database from.
//
// Every suite runs sync({ force: true }) and drops its tables afterwards. Jest
// does not read .env, so DATABASE_URL comes from the shell, and a shell that
// still has the dev URL exported would wipe the dev database without a word.
// Refusing any database whose name does not end in _test makes that mistake a
// loud failure instead.

/** DATABASE_URL, but only if it names a throwaway test database. */
export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. Point it at a database you do not mind being ' +
        'dropped, e.g. postgres://postgres@127.0.0.1:5432/inventory_test',
    );
  }

  const name = new URL(raw).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run against database "${name}": the suites drop every table. ` +
        'Use a database whose name ends in _test (docs/TESTING.md).',
    );
  }

  return raw;
}
