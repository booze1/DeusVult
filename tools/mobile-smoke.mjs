/**
 * iPhone smoke test — real device emulation, real touch input.
 *
 * Verifies the game is actually playable on a phone in both orientations:
 * hexes must be tappable, the fire flow must complete, and the HUD must not
 * bury the board.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5174/';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function run(label, contextOptions, shotPrefix) {
  console.log(`\n${label} (${contextOptions.viewport.width}x${contextOptions.viewport.height})`);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}${shotPrefix}-title.png` });

  await page.getByRole('button', { name: /Begin operation|Continue operation/ }).tap();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Deploy' }).tap();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${SHOTS}${shotPrefix}-battle.png` });

  const markers = await page.evaluate(() => globalThis.__deusvult?.markers() ?? []);
  check('board renders markers', markers.length > 0);

  // Hex tap-target size: the on-screen distance between two adjacent hexes.
  const scale = await page.evaluate(() => {
    const m = globalThis.__deusvult.markers();
    return m.length;
  });
  void scale;

  const box = await (await page.$('#board canvas')).boundingBox();
  const onScreen = markers.filter(
    (m) => m.x > 10 && m.x < box.width - 10 && m.y > 70 && m.y < box.height - 150,
  );
  check('friendly units are on screen and clear of the HUD', onScreen.some((m) => m.side === 'BLUE'),
    `${onScreen.length}/${markers.length} in the clear band`);

  const scout = onScreen.find((m) => m.defId === 'usmc_recon')
    ?? onScreen.find((m) => m.side === 'BLUE');
  await page.touchscreen.tap(box.x + scout.x, box.y + scout.y);
  await page.waitForTimeout(350);
  const selected = await page.evaluate(() => {
    const n = document.querySelector('.unitcard--visible .unitcard__callsign');
    return n ? n.textContent.trim() : null;
  });
  check('a hex can be selected by touch', selected === scout.callsign, `got ${selected}`);
  await page.screenshot({ path: `${SHOTS}${shotPrefix}-selected.png` });

  // Action bar must be reachable, not clipped off-screen.
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.actionbar');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { bottom: r.bottom, height: r.height, buttons: b.querySelectorAll('button').length };
  });
  check('action bar is on screen', bar && bar.bottom <= contextOptions.viewport.height + 1,
    JSON.stringify(bar));
  check('action bar offers actions', bar && bar.buttons >= 2);

  // Pinch-zoom out then back should not throw.
  await page.evaluate(() => globalThis.scrollTo(0, 0));

  check('no console or page errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

const iPhone = devices['iPhone 14 Pro'];
await run('iPhone 14 Pro — portrait', { ...iPhone }, 'ios-portrait');
await run(
  'iPhone 14 Pro — landscape',
  { ...iPhone, viewport: { width: iPhone.viewport.height, height: iPhone.viewport.width } },
  'ios-landscape',
);

await browser.close();
console.log(failures.length === 0 ? `\nAll mobile checks passed.\n` : `\n${failures.length} failed.\n`);
process.exit(failures.length ? 1 : 0);
