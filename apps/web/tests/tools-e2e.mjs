// tools-e2e.mjs checks the export, label and import flows in a real browser -
// including that a plan-gated download tells the customer to upgrade rather
// than navigating the tab to a JSON error page.
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function signIn(email) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', 'correcthorse99');
  await page.click('button[type=submit]');
  await page.waitForURL('**/register');
  return page;
}

console.log('\n1. Free plan — CSV works, Excel is gated');
const free = await signIn('a@lanka.lk');
await free.goto(`${BASE}/tools`, { waitUntil: 'networkidle' });

const csvDownload = free.waitForEvent('download', { timeout: 20000 });
await free.getByRole('button', { name: /download csv/i }).click();
const csvFile = await csvDownload;
ok('CSV downloads on the free plan', /\.csv$/.test(csvFile.suggestedFilename()), csvFile.suggestedFilename());

await free.getByRole('button', { name: /^excel$/i }).click();
await free.waitForSelector('.limit-prompt', { timeout: 15000 }).catch(() => {});
const gated = await free.locator('.limit-prompt').innerText().catch(() => '');
ok('Excel shows an upgrade prompt, not an error', /not included in your plan/i.test(gated), gated.replace(/\n/g, ' ').slice(0, 70));
ok('the tab did not navigate away', free.url().includes('/tools'));

console.log('\n2. Paid plan — Excel, report and labels download');
const paid = await signIn('b@ceylon.lk');
await paid.goto(`${BASE}/tools`, { waitUntil: 'networkidle' });

for (const [name, pattern] of [
  [/^excel$/i, /\.xlsx$/],
  [/pdf report/i, /\.pdf$/],
  [/print label sheet/i, /labels.*\.pdf$/],
]) {
  const pending = paid.waitForEvent('download', { timeout: 20000 });
  await paid.getByRole('button', { name }).click();
  const file = await pending;
  ok(`${String(name)} downloads`, pattern.test(file.suggestedFilename()), file.suggestedFilename());
}

console.log('\n3. Import');
const RUN = Date.now().toString(36);
await paid.fill('#csv', `Name,Location,Qty\nImported chair ${RUN},Store ${RUN},4\n,Store ${RUN},1`);
await paid.getByRole('button', { name: /check file/i }).click();
await paid.waitForSelector('.error, .banner', { timeout: 15000 });
const problems = await paid.locator('.error').innerText().catch(() => '');
ok('a bad row is reported with its line number', /line 3/i.test(problems), problems.replace(/\n/g, ' ').slice(0, 70));
ok('the Import button stays disabled while the file has problems',
   await paid.getByRole('button', { name: /^import$/i }).isDisabled());

await paid.fill('#csv', `Name,Location,Qty\nImported chair ${RUN},Store ${RUN},4`);
await paid.getByRole('button', { name: /check file/i }).click();
await paid.waitForSelector('.banner', { timeout: 15000 });
ok('a clean file enables Import',
   !(await paid.getByRole('button', { name: /^import$/i }).isDisabled()));

await paid.getByRole('button', { name: /^import$/i }).click();
// Wait for the banner's TEXT to change, not merely for a .banner to exist -
// the dry-run banner is already on screen, so the selector matches instantly
// and would be read before the import has answered.
await paid
  .locator('.banner', { hasText: /imported/i })
  .waitFor({ timeout: 20000 })
  .catch(() => {});
const imported = await paid.locator('.banner').first().innerText();
ok('the import reports what it did', /imported 1 item/i.test(imported), imported.replace(/\n/g, ' ').slice(0, 70));
ok('it says the location was created', /created 1 location/i.test(imported));

await paid.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await paid.waitForTimeout(1500);
const names = await paid.locator('article.asset .name').allInnerTexts();
ok('the imported item is in the register', names.includes(`Imported chair ${RUN}`), names.slice(0, 3).join(', '));

await browser.close();
if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
