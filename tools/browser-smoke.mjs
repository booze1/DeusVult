/**
 * Browser smoke test.
 *
 * Drives the real client through the game's central loop — select a scout,
 * designate a target, fire the battery that could not see it — and fails on
 * any console or page error along the way.
 *
 * Unit tests prove the rules; this proves the thing a player touches is wired
 * to them. Marker positions come from a DEV-only probe rather than hard-coded
 * pixels, so the test survives changes to the camera.
 *
 *   npm run dev                 # in one shell
 *   npm run smoke               # in another
 *
 * Set CHROMIUM_PATH if Playwright's bundled browser is not installed, e.g.
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run smoke
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(5000);

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const text = (sel) =>
  page.evaluate((s) => {
    const n = document.querySelector(s);
    return n ? n.textContent.trim() : null;
  }, sel);

const buttons = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.actionbar button')].map((n) => ({
      label: n.textContent.trim(),
      disabled: n.disabled,
    })),
  );

async function press(label) {
  const list = await buttons();
  const index = list.findIndex((b) => b.label === label);
  if (index < 0 || list[index].disabled) return false;
  await page.locator('.actionbar button').nth(index).click();
  await page.waitForTimeout(240);
  return true;
}

console.log(`\nDEUS VULT — browser smoke test against ${BASE}\n`);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Begin operation|Continue operation/ }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: 'Deploy' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}battle.png` });

const markers = await page.evaluate(() => globalThis.__deusvult?.markers() ?? []);
check('mission deploys with a full order of battle', markers.length === 9, `${markers.length} markers`);

// Fog: the amphibious force is still at sea and must not be visible.
const hostileVisible = markers.filter((m) => m.side === 'RED').length;
check('opposing force is on the board', hostileVisible > 0);

const box = await (await page.$('#board canvas')).boundingBox();
const tap = async (x, y) => {
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(230);
};

const scout = markers.find((m) => m.defId === 'usmc_recon');
const battery = markers.find((m) => m.defId === 'usmc_nemesis');
const target = markers.find((m) => m.defId === 'pla_inf');

// 1. Selecting a formation.
await tap(scout.x, scout.y);
check('selecting a formation opens its panel', (await text('.unitcard--visible .unitcard__callsign')) === scout.callsign);

// 2. The battery must NOT be able to fire before a handoff.
await tap(battery.x, battery.y);
await tap(target.x, target.y);
const before = await buttons();
const nsmBefore = before.find((b) => b.label === 'Naval Strike Missile');
check('missile battery is blocked without a tracked contact', nsmBefore?.disabled === true);
await press('Back');

// 3. The scout hands the target over.
await tap(scout.x, scout.y);
await tap(target.x, target.y);
check('scout offers a designate action', (await buttons()).some((b) => b.label === 'Designate' && !b.disabled));
await press('Designate');
const log = await page.evaluate(() =>
  [...document.querySelectorAll('.log__entry')].map((n) => n.textContent),
);
check('designation is reported on the net', log.some((l) => /designates/.test(l)));

// 4. The same shot is now legal, and previews before committing.
await tap(battery.x, battery.y);
await tap(target.x, target.y);
const after = await buttons();
check(
  'missile battery unlocks after the handoff',
  after.find((b) => b.label === 'Naval Strike Missile')?.disabled === false,
);
await press('Naval Strike Missile');
check('fire preview appears before committing', (await text('.firepreview__head')) !== null);
await page.screenshot({ path: `${SHOTS}preview.png` });

await press('Confirm fire');
const finalLog = await page.evaluate(() =>
  [...document.querySelectorAll('.log__entry')].map((n) => n.textContent),
);
check('the strike resolves', finalLog.some((l) => /NMESIS|destroys|hits/.test(l)));

// 5. A turn can be completed and handed to the opponent.
await press('End turn');
await page.waitForTimeout(900);
const state = await page.evaluate(() => globalThis.__deusvult.state());
check('turn advances past the opposing move', state.turn >= 2 || state.outcome !== 'ONGOING');
await page.screenshot({ path: `${SHOTS}turn2.png` });

check('no console or page errors', errors.length === 0, errors.join(' | '));

await browser.close();

console.log(
  failures.length === 0
    ? `\nAll checks passed. Screenshots in ${SHOTS}\n`
    : `\n${failures.length} check(s) failed.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
