// billing-e2e.mjs checks the plan screen a paying customer and a lapsed one
// each see.
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.E2E_EMAIL ?? 'b@ceylon.lk';
const PASSWORD = process.env.E2E_PASSWORD ?? 'correcthorse99';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/register');

console.log('\n1. A paying customer');
await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const names = await page.locator('.plan-name').allInnerTexts();
ok('the paid plan is marked current', names.some(n => /Starter.*current/.test(n)), names.join(' | '));
const limitText = await page.locator('.plan-card.current ul').innerText();
ok('the current plan shows its real limits', /1,000 assets/.test(limitText), limitText.replace(/\n/g, ' '));
const invoiceRows = await page.locator('table.invoices tr').count();
ok('the paid invoice is listed', invoiceRows >= 1, `${invoiceRows} row(s)`);
const invoiceText = await page.locator('table.invoices').innerText();
ok('the invoice shows as paid', /paid/i.test(invoiceText));
ok('there is a cancel option', (await page.getByRole('button', { name: /cancel subscription/i }).count()) === 1);
ok('there is an upgrade button for the higher plan',
   (await page.getByRole('button', { name: /upgrade to business/i }).count()) === 1);
ok('no upgrade button for the plan already held',
   (await page.getByRole('button', { name: /upgrade to starter/i }).count()) === 0);

console.log('\n2. The return from a checkout');
await page.goto(`${BASE}/billing?payment=cancelled`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const cancelledNotice = await page.locator('.banner').first().innerText().catch(() => '');
ok('a cancelled payment says nothing was charged', /nothing has been charged/i.test(cancelledNotice), cancelledNotice.slice(0, 60));

await page.goto(`${BASE}/billing?payment=done`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const doneNotice = await page.locator('.banner').first().innerText().catch(() => '');
ok('a returned payment says confirming, not paid', /being confirmed/i.test(doneNotice), doneNotice.slice(0, 60));

await browser.close();
if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
