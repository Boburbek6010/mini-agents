/** Browser verification against the actual UI and isolated production server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { launchStandalone } from '../e2e/helpers/standalone.js';

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
    await page.waitForFunction(() => window.__pixelAgentsTestHooks?.getCharacters?.().length === 9);
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'art/claude-studio/office-after.png' });

    // Click a real rendered mascot, then change its identity through the UI.
    await page.mouse.click(351, 342);
    await page.getByRole('button', { name: 'Mascots', exact: true }).click();
    const astronaut = page.getByRole('button', { name: /Astronaut Ready for launch/ });
    assert.equal(await astronaut.isEnabled(), true, 'canvas click must select the mascot');
    await astronaut.click();
    assert.equal(await astronaut.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /Detective A nose for bugs/ }).click();
    await page.screenshot({ path: 'art/claude-studio/mascot-picker.png' });
    assert.deepEqual(errors, []);
    console.log(
      'Browser preview: nine mascots, click selection, picker changes, and no runtime errors.',
    );

    // Exercise the real production CLI/WS asset path, with a temporary profile.
    // The repository helper isolates HOME/USERPROFILE; no real sessions or hooks.
    const scratch = fs.mkdtempSync(path.resolve('test-results/studio-'));
    const live = await browser.newPage();
    const received: Array<Record<string, unknown>> = [];
    live.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        try {
          received.push(JSON.parse(payload.toString()));
        } catch {
          /* Ignore non-JSON frames. */
        }
      }),
    );
    const session = await launchStandalone(live, {
      homeDir: path.join(scratch, 'profile'),
      workspaceDir: path.join(scratch, 'workspace'),
      seedHooksConsent: false,
    });
    try {
      const charactersMessage = received.find(
        (message) => message.type === 'characterSpritesLoaded',
      );
      const characters = charactersMessage?.characters as Array<{ down: string[][][] }>;
      assert.equal(characters?.length, 9);
      assert.equal(characters[0].down[0][0].length, 32);
      const layoutMessage = received.find((message) => message.type === 'layoutLoaded');
      const layout = layoutMessage?.layout as { cols: number; layoutRevision: number };
      assert.equal(layout.cols, 32);
      assert.equal(layout.layoutRevision, 2);
      await live.getByRole('button', { name: 'Mascots', exact: true }).waitFor();
      assert.equal(
        await live.getByText('Studio sandbox · changes saved in this browser').count(),
        0,
      );
      console.log(
        'Production CLI: server connected, all nine wide sheets and layout revision 2 delivered over WebSocket.',
      );
    } finally {
      await session.cleanup();
    }
  } finally {
    await browser.close();
  }
}

fs.mkdirSync('test-results', { recursive: true });
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
