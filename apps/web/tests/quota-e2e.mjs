// quota-e2e.mjs checks what a person on a full plan actually sees.
//
// The API returning 402 is not the deliverable; a person being told what is
// wrong and what to do about it is.
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

console.log('\n1. Plan screen');
await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const bars = await page.locator('.usage-track').count();
ok('usage bars render', bars >= 3, `${bars} bars`);
const full = await page.locator('.usage-fill.full').count();
ok('a full metric is marked as full', full >= 1);
const planNames = await page.locator('.plan-name').allInnerTexts();
ok('all three plans are listed', planNames.length === 3, planNames.join(' | '));
ok('the current plan is marked', planNames.some(n => n.includes('current')));

console.log('\n2. Capture on a full plan');
await page.goto(`${BASE}/capture`, { waitUntil: 'networkidle' });
await page.fill('#name', `Over limit ${Date.now().toString(36)}`);
await page.click('button[type=submit]');
await page.waitForSelector('.limit-prompt', { timeout: 15000 }).catch(() => {});
const prompt = await page.locator('.limit-prompt').innerText().catch(() => '');
ok('an upgrade prompt is shown, not a raw error', /plan is full/i.test(prompt), prompt.replace(/\n/g, ' ').slice(0, 90));
ok('it says the item was not saved', /not saved/i.test(prompt));
ok('no red error box is shown instead', (await page.locator('.error').count()) === 0);
const link = await page.locator('.limit-prompt a').getAttribute('href');
ok('it links to the plan screen', link === '/billing', String(link));

await browser.close();
if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
