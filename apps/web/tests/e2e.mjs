// e2e.mjs drives a real browser through the paths that cannot be proved any
// other way: that the auth cookie is httpOnly and no token is readable from
// JavaScript, and that a capture made with no signal reaches the register
// exactly once when the connection returns.
//
// Needs the API and the web app both running, and a user that can sign in.
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.E2E_EMAIL ?? 'a@lanka.lk';
const PASSWORD = process.env.E2E_PASSWORD ?? 'correcthorse99';

// Set where the container already has a browser (Claude Code's image does);
// otherwise Playwright uses its own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

// Unique per run. The register is never reset between runs, and each run
// legitimately creates new rows - an idempotency key covers a retry of one
// capture, not two separate runs - so the "exactly once" check has to look for
// this run's own item rather than any item with a familiar name.
const RUN = Date.now().toString(36);
const OFFLINE_NAME = `Offline capture ${RUN}`;
let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch(
  executablePath ? { executablePath } : {},
);
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

console.log('\n1. Auth guard');
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
ok('unauthenticated visit redirects to /login', page.url().includes('/login'), page.url());

console.log('\n2. Sign in');
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/register', { timeout: 15000 });
ok('lands on the register', page.url().includes('/register'));

const cookies = await context.cookies();
ok('access_token cookie is httpOnly',
   cookies.find(c => c.name === 'access_token')?.httpOnly === true);
const tokenInJs = await page.evaluate(() => JSON.stringify(Object.keys(localStorage)));
ok('no token in localStorage', tokenInJs === '[]', tokenInJs);

await page.waitForTimeout(1200);
const listed = await page.locator('article.asset').count();
ok('register shows existing assets', listed > 0, `${listed} rows`);

console.log('\n3. Capture online');
await page.click('a[href="/capture"]');
await page.waitForSelector('#name');
await page.fill('#name', `Monitor ${RUN}`);
await page.fill('#serial', 'SN-E2E-001');
await page.click('button[type=submit]');
await page.waitForSelector('.toast', { timeout: 15000 });
const toast = await page.locator('.toast').innerText();
ok('capture succeeds and shows the issued code', /TS-\d{4}/.test(toast), toast.replace(/\n/g,' '));
ok('name field cleared for the next item', (await page.inputValue('#name')) === '');

console.log('\n4. Sticky fields');
await page.selectOption('#status', 'in_store');
await page.fill('#name', `Second item ${RUN}`);
await page.click('button[type=submit]');
await page.waitForTimeout(2500);
ok('status stayed set after a capture', (await page.inputValue('#status')) === 'in_store');

console.log('\n5. Offline capture -> outbox');
await context.setOffline(true);
await page.fill('#name', OFFLINE_NAME);
await page.click('button[type=submit]');
await page.waitForTimeout(2500);
const offlineToast = await page.locator('.toast').innerText().catch(()=>'');
ok('offline capture is queued, not lost', /sync/i.test(offlineToast), offlineToast.replace(/\n/g,' '));
const queuedCount = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('inventory-outbox', 1);
  r.onsuccess = () => { const db = r.result;
    const g = db.transaction('captures','readonly').objectStore('captures').getAll();
    g.onsuccess = () => res(g.result.length); };
  r.onerror = () => res(-1);
}));
ok('the capture is in IndexedDB', queuedCount === 1, `${queuedCount} queued`);

console.log('\n6. Back online -> flush');
await context.setOffline(false);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const afterFlush = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('inventory-outbox', 1);
  r.onsuccess = () => { const db = r.result;
    const g = db.transaction('captures','readonly').objectStore('captures').getAll();
    g.onsuccess = () => res(g.result.length); };
  r.onerror = () => res(-1);
}));
ok('outbox drained after reconnect', afterFlush === 0, `${afterFlush} left`);

await page.click('a[href="/register"]');
await page.waitForTimeout(2000);
const names = await page.locator('article.asset .name').allInnerTexts();
ok('the offline capture reached the register',
   names.includes(OFFLINE_NAME), names.slice(0, 3).join(', '));
ok('it appears exactly once (no duplicate)',
   names.filter(n => n === OFFLINE_NAME).length === 1,
   `${names.filter(n => n === OFFLINE_NAME).length} copies`);

console.log('\n7. Sign out');
await page.click('a[href="/more"]');
await page.waitForSelector('button.ghost');
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForURL('**/login', { timeout: 15000 });
ok('sign out returns to login', page.url().includes('/login'));

console.log('\n8. Console errors');
ok('no uncaught page errors', errors.length === 0, errors.slice(0,2).join(' | '));

await browser.close();

// A non-zero exit, so this fails a CI job rather than printing FAIL and passing.
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
