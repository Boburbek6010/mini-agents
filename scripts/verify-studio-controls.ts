import assert from 'node:assert/strict';

import { chromium, expect } from '@playwright/test';

const KEY = 'pixel-agents:studio-preview:v1';
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as unknown as { __PIXEL_AGENTS_E2E: boolean }).__PIXEL_AGENTS_E2E = true;
    });
    await page.goto('http://127.0.0.1:5173/?studio=1');
    const ready = () =>
      page.waitForFunction(() => window.__pixelAgentsTestHooks?.getCharacters?.().length === 9);
    await ready();
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), KEY);
    const click = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const tile = async (col: number, row: number) => {
      await page.mouse.move(208 + (col + 0.5) * 32, 148 + (row + 0.5) * 32);
      await page.mouse.click(208 + (col + 0.5) * 32, 148 + (row + 0.5) * 32);
    };
    const closeModal = () => page.getByRole('button', { name: 'x', exact: true }).click();

    await click('Layout');
    await click('Furniture');
    await click('Decor');
    await page.getByTitle('Pot', { exact: true }).click();
    await tile(8, 10);
    await click('Save');
    const added = (await stored()).layout;
    assert.equal(added.furniture.length, 64);
    assert.ok(
      added.furniture.some(
        (item: { type: string; col: number; row: number }) =>
          item.type === 'POT' && item.col === 8 && item.row === 10,
      ),
    );

    await click('Floor');
    await page.getByTitle('Floor 3', { exact: true }).click();
    await tile(9, 10);
    await click('Undo');
    await click('Save');
    assert.notEqual((await stored()).layout.tiles[10 * 32 + 9], 3);
    // A second stroke and redo exercise the real editor stacks.
    await tile(9, 10);
    await click('Undo');
    await click('Redo');
    await click('Save');
    assert.equal((await stored()).layout.tiles[10 * 32 + 9], 3);

    await click('Walls');
    await tile(10, 10);
    await click('Save');
    assert.ok(
      (await stored()).layout.tiles.filter((v: number) => v === 0).length >
        added.tiles.filter((v: number) => v === 0).length,
    );
    await click('Pets');
    await page.getByTitle('Claudio', { exact: true }).click();
    await click('Save');
    assert.equal((await stored()).layout.pets.length, 1);

    await click('Furniture');
    await click('Carpet');
    await page.getByTitle('Carpet 1', { exact: true }).click();
    await tile(11, 10);
    await click('Save');
    assert.equal((await stored()).layout.carpetTiles[10 * 32 + 11].variant, 0);

    await click('Areas');
    await page.getByTitle('Studio — double-click to rename', { exact: true }).click();
    await tile(19, 10);
    await click('Save');
    assert.equal((await stored()).layout.areaTiles[10 * 32 + 19], 'Studio');
    await click('Erase');
    await tile(8, 10);
    await click('Save');
    assert.equal((await stored()).layout.furniture.length, 63);
    await click('Layout');

    await click('Settings');
    await click('Always Show Labels');
    await click('Sound Notifications');
    await expect(
      page.getByRole('button', { name: 'Instant Detection (Hooks)', exact: true }),
    ).toBeDisabled();
    await closeModal();
    await click('Mascots');
    await page.getByLabel('Agent to customize').selectOption('901');
    await page.getByRole('button', { name: 'Pilot Cleared for takeoff', exact: true }).click();
    assert.equal((await stored()).seats['901'].palette, 8);
    await closeModal();
    await page.reload();
    await ready();
    await page.waitForFunction(() => window.__pixelAgentsTestHooks?.getPets?.().length === 1);
    const restored = await stored();
    assert.equal(restored.layout.tiles[10 * 32 + 9], 3);
    assert.equal(restored.layout.carpetTiles[10 * 32 + 11].variant, 0);
    await click('Settings');
    await expect(
      page.getByRole('button', { name: 'Always Show Labels', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Sound Notifications', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await closeModal();
    await click('Mascots');
    await page.getByLabel('Agent to customize').selectOption('901');
    await expect(
      page.getByRole('button', { name: 'Pilot Cleared for takeoff', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: 'art/claude-studio/nine-mascots.png' });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: furniture placement/erase, floor/wall/carpet/area painting, undo/redo, pets, settings, all nine mascots, and persistence across reload.',
    );
  } finally {
    await browser.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
