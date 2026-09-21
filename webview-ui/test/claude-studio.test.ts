/// <reference lib="dom" />
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { test } from 'vitest';

import { buildFurnitureCatalog } from '../../core/src/assets/build.js';
import { decodeAllCharacters, decodeAllFurniture } from '../../core/src/assets/loader.js';
import { decodeCharacterPng } from '../../core/src/assets/pngDecoder.js';
import { FALLBACK_FLOOR_COLOR } from '../src/constants.js';
import { createCharacter } from '../src/office/engine/characters.js';
import { renderMatrixEffect } from '../src/office/engine/matrixEffect.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import {
  getBlockedTiles,
  layoutToSeats,
  layoutToTileMap,
} from '../src/office/layout/layoutSerializer.js';
import { findPath } from '../src/office/layout/tileMap.js';
import { setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout } from '../src/office/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = path.join(root, 'webview-ui/public/assets');

test('all nine mascots decode into complete, distinct walking, working and reading animations', () => {
  const characters = decodeAllCharacters(assets);
  assert.equal(characters.length, 9);
  for (const character of characters) {
    for (const direction of ['down', 'up', 'right'] as const) {
      const frames = character[direction];
      assert.equal(frames.length, 7);
      for (const frame of frames) {
        assert.equal(frame.length, 32);
        assert.ok(frame.every((row) => row.length === 32));
        assert.ok(
          frame.flat().some((pixel) => pixel !== ''),
          'frame must contain visible artwork',
        );
        assert.ok(
          frame.flat().some((pixel) => pixel === ''),
          'background must be transparent',
        );
      }
      assert.notDeepEqual(frames[0], frames[1], 'walk must animate');
      assert.notDeepEqual(frames[3], frames[4], 'work must animate');
      assert.notDeepEqual(frames[5], frames[6], 'reading must animate');
    }
    assert.notDeepEqual(character.down[1], character.up[1], 'back view must be a real turnaround');
  }
  assert.equal(new Set(characters.map((c) => JSON.stringify(c.down[1]))).size, 9);
});

test('legacy 16-pixel characters still decode, and malformed sheets are rejected', () => {
  const legacy = decodeCharacterPng(
    fs.readFileSync(path.join(root, 'art/claude-studio/original-characters/char_0.png')),
  );
  assert.equal(legacy.down[0][0].length, 16);
  assert.equal(legacy.down[0].length, 32);
  const invalid = PNG.sync.write(new PNG({ width: 100, height: 96 }));
  assert.throws(() => decodeCharacterPng(invalid), /Invalid character sheet/);
});

test('studio furniture fits the map and every seat can be reached from the central aisle', () => {
  const catalog = buildFurnitureCatalog(assets);
  buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(assets, catalog) });
  const layout = JSON.parse(
    fs.readFileSync(path.join(assets, 'default-layout-2.json'), 'utf8'),
  ) as OfficeLayout;
  assert.equal(layout.tiles.length, layout.cols * layout.rows);
  assert.equal(layout.tileColors?.length, layout.tiles.length);
  for (const item of layout.furniture) {
    const entry = getCatalogEntry(item.type);
    assert.ok(entry, `unknown furniture ${item.type}`);
    assert.ok(item.col >= 0 && item.row >= 0);
    assert.ok(item.col + entry.footprintW <= layout.cols, item.uid);
    assert.ok(item.row + entry.footprintH <= layout.rows, item.uid);
  }
  const tileMap = layoutToTileMap(layout);
  const seats = layoutToSeats(layout.furniture);
  assert.ok(seats.size >= 6);
  for (const seat of seats.values()) {
    // The movement engine excludes the destination's own seat from blockers.
    const blocked = getBlockedTiles(layout.furniture, new Set([`${seat.seatCol},${seat.seatRow}`]));
    const route = findPath(19, 10, seat.seatCol, seat.seatRow, tileMap, blocked);
    assert.ok(route.length > 0, `unreachable seat: ${seat.uid}`);
  }
});

test('wide mascots remain clickable at the edges and persist their selected identity', () => {
  setCharacterTemplates(decodeAllCharacters(assets));
  const os = new OfficeState();
  os.addAgent(1, 4, 0, undefined, true);
  const ch = os.characters.get(1)!;
  assert.equal(os.getCharacterAt(ch.x + 12, ch.y - 10), 1);
  ch.palette = 5;
  assert.equal(os.getPersistableSeats()[1].palette, 5);
});

test('spawn and despawn rendering includes the full width and feet of a mascot', () => {
  const sprite = Array.from({ length: 32 }, () => Array<string>(32).fill(''));
  sprite[31][31] = FALLBACK_FLOOR_COLOR;
  const ch = createCharacter(1, 0, null, null);
  ch.matrixEffect = 'despawn';
  ch.matrixEffectTimer = 0;
  ch.matrixEffectSeeds = Array<number>(16).fill(0);
  const painted: number[][] = [];
  const context = { fillStyle: '', fillRect: (x: number, y: number) => painted.push([x, y]) };
  renderMatrixEffect(context as unknown as CanvasRenderingContext2D, ch, sprite, 0, 0, 1);
  assert.ok(
    painted.some(([x, y]) => x === 31 && y === 31),
    'rightmost foot must not be clipped',
  );
});
