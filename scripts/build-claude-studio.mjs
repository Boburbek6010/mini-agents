/** Reproducible game-asset packing. Source artwork: art/claude-studio/mascot-turnarounds.png. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'webview-ui/public/assets');
const art = path.join(root, 'art/claude-studio');
const atlases = ['mascot-turnarounds.png', 'mascot-turnarounds-extra.png'].map((file) =>
  PNG.sync.read(fs.readFileSync(path.join(art, file))),
);
const names = [
  'Detective',
  'Wizard',
  'Lo-fi',
  'Chef',
  'Astronaut',
  'Gardener',
  'Robot',
  'Artist',
  'Pilot',
];

// Trim each turnaround's transparent padding, retain proportions, and pack
// it into a 32x32 frame, preserving the same seven-frame/three-direction contract.
function trimBounds(atlas, column, row, columns) {
  const cellW = atlas.width / columns;
  const cellH = atlas.height / 3;
  const box = {
    left: Math.ceil((column + 1) * cellW),
    top: Math.ceil((row + 1) * cellH),
    right: 0,
    bottom: 0,
  };
  for (let y = Math.floor(row * cellH); y < Math.floor((row + 1) * cellH); y++) {
    for (let x = Math.floor(column * cellW); x < Math.floor((column + 1) * cellW); x++) {
      if (atlas.data[(y * atlas.width + x) * 4 + 3] < 160) continue;
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return box;
}

function pixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  png.data.set(rgba, (y * png.width + x) * 4);
}

for (let character = 0; character < names.length; character++) {
  const atlas = atlases[character < 6 ? 0 : 1];
  const column = character < 6 ? character : character - 6;
  const boxes = [0, 1, 2].map((row) => trimBounds(atlas, column, row, character < 6 ? 6 : 3));
  const scale = Math.min(
    ...boxes.map((b) => Math.min(26 / (b.right - b.left + 1), 28 / (b.bottom - b.top + 1))),
  );
  const sheet = new PNG({ width: 224, height: 96 });
  for (let direction = 0; direction < 3; direction++) {
    const box = boxes[direction];
    const width = Math.round((box.right - box.left + 1) * scale);
    const height = Math.round((box.bottom - box.top + 1) * scale);
    const ox = Math.floor((32 - width) / 2);
    const oy = 30 - height;
    for (let frame = 0; frame < 7; frame++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = Math.min(box.right, box.left + Math.floor((x + 0.5) / scale));
          const sy = Math.min(box.bottom, box.top + Math.floor((y + 0.5) / scale));
          const idx = (sy * atlas.width + sx) * 4;
          const rgba = [...atlas.data.subarray(idx, idx + 4)];
          if (rgba[3] < 160) continue;
          rgba[3] = 255;
          // Opposite feet lift on walk beats; middle frame is the idle pose.
          const liftFoot = (frame === 0 && x < width / 2) || (frame === 2 && x >= width / 2);
          const dy = frame < 3 && liftFoot && y >= height - 3 ? -1 : 0;
          const bob = frame === 0 || frame === 2 ? -1 : 0;
          pixel(sheet, frame * 32 + ox + x, direction * 32 + oy + y + dy + bob, rgba);
        }
      }
      // Work frames have a two-beat keyboard or an open book. Up-facing
      // characters work behind their bodies; side profiles work to the right.
      if (frame >= 3 && direction !== 1) {
        const reading = frame >= 5;
        const left = direction === 2 ? 22 : 12;
        const top = 26;
        for (let y = 0; y < (reading ? 4 : 3); y++) {
          for (let x = 0; x < 7 && left + x < 32; x++) {
            const color = reading
              ? x === 3
                ? [183, 133, 79, 255]
                : [255, 230, 182, 255]
              : y === 1 && x % 2 === frame % 2
                ? [179, 206, 202, 255]
                : [37, 57, 61, 255];
            pixel(sheet, frame * 32 + left + x, direction * 32 + top + y, color);
          }
        }
        pixel(
          sheet,
          frame * 32 + left + (frame % 2 ? 1 : 5),
          direction * 32 + top - 1,
          [255, 137, 80, 255],
        );
      }
      // Back-facing work beats: small, alternating arm motion.
      if (frame >= 3 && direction === 1) {
        pixel(sheet, frame * 32 + (frame % 2 ? 4 : 27), direction * 32 + 25, [255, 137, 80, 255]);
      }
    }
  }
  fs.writeFileSync(path.join(assets, `characters/char_${character}.png`), PNG.sync.write(sheet));
}

// Warm open-plan office: a connected central aisle separates the work floor
// from the meeting nook and cafe. All items remain native editor furniture.
const cols = 32,
  rows = 22;
const layout = {
  version: 1,
  cols,
  rows,
  layoutRevision: 2,
  tiles: Array(cols * rows).fill(255),
  tileColors: Array(cols * rows).fill(null),
  furniture: [],
  carpetTiles: Array(cols * rows).fill(null),
  areas: [
    { label: 'Studio', color: '#c98b57' },
    { label: 'Meeting nook', color: '#89a493' },
    { label: 'Coffee lounge', color: '#cf8e76' },
  ],
  areaTiles: Array(cols * rows).fill(null),
  pets: [],
};
const oak = { h: 32, s: 32, b: 22, c: -50 };
const limestone = { h: 38, s: 18, b: 30, c: -68 };
const wall = { h: 154, s: 15, b: -27, c: -60 };
const sage = { h: 152, s: 21, b: 5, c: -48, colorize: true };
const terracotta = { h: 18, s: 41, b: 8, c: -38, colorize: true };
function floor(x1, y1, x2, y2, tile, color, area) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++) {
      const i = y * cols + x;
      layout.tiles[i] = tile;
      layout.tileColors[i] = color;
      layout.areaTiles[i] = area ?? null;
    }
}
floor(1, 2, 30, 20, 7, oak, 'Studio');
floor(1, 2, 30, 2, 0, wall);
floor(1, 3, 1, 20, 0, wall);
floor(30, 3, 30, 20, 0, wall);
floor(20, 3, 29, 20, 1, limestone);
floor(18, 3, 19, 20, 1, limestone);
// Partial divider, with generous three-tile openings in the central aisle.
floor(20, 3, 20, 7, 0, wall);
floor(20, 12, 20, 15, 0, wall);
floor(21, 3, 29, 10, 1, limestone, 'Meeting nook');
floor(21, 12, 29, 20, 9, { h: 34, s: 16, b: 29, c: -80 }, 'Coffee lounge');

function rug(x1, y1, x2, y2, hue) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++) {
      layout.carpetTiles[y * cols + x] = {
        variant: 0,
        color: { h: hue, s: 20, b: 8, c: -55, colorize: true },
        accentColor: { h: 38, s: 23, b: 36, c: -55, colorize: true },
      };
    }
}
rug(3, 5, 16, 8, 155);
rug(3, 11, 16, 14, 155);
rug(23, 4, 28, 9, 160);
rug(22, 14, 28, 18, 19);
function item(type, col, row, uid, color) {
  layout.furniture.push({
    uid: uid ?? `studio-${type.toLowerCase()}-${col}-${row}`,
    type,
    col,
    row,
    ...(color ? { color } : {}),
  });
}
// Six stations face forward, so mascots remain visible above the worktops.
for (const [index, [col, row]] of [
  [3, 5],
  [8, 5],
  [13, 5],
  [3, 11],
  [8, 11],
  [13, 11],
].entries()) {
  item('CUSHIONED_CHAIR_FRONT', col + 1, row + 1, `studio-seat-${index}`, sage);
  item('DESK_FRONT', col, row + 1);
  item('PC_BACK', col + 2, row + 1);
  item('COFFEE', col, row + 1);
}
// Books, hanging foliage, a clock and a whiteboard along the north wall.
for (const col of [3, 8, 13]) item('BOOKSHELF', col, 2);
for (const col of [2, 6, 11, 16, 29]) item('HANGING_PLANT', col, 2);
item('CLOCK', 18, 2);
item('WHITEBOARD', 24, 2);
item('LARGE_PLANT', 17, 4);
item('LARGE_PLANT', 17, 12);
item('PLANT_2', 21, 3);
item('PLANT', 28, 3);
// Meeting room, accessible seats on all four sides.
item('TABLE_FRONT', 24, 5);
item('CUSHIONED_CHAIR_SIDE', 23, 6, undefined, sage);
item('CUSHIONED_CHAIR_SIDE', 23, 8, undefined, sage);
item('CUSHIONED_CHAIR_SIDE:left', 27, 6, undefined, sage);
item('CUSHIONED_CHAIR_SIDE:left', 27, 8, undefined, sage);
item('COFFEE', 24, 5);
item('POT', 25, 7);
// Library bench and small coffee stations at the south of the work floor.
item('SMALL_TABLE_FRONT', 3, 18);
item('COFFEE', 3, 18);
item('COFFEE', 4, 18);
item('SOFA_FRONT', 7, 18, undefined, sage);
item('SOFA_FRONT', 9, 18, undefined, sage);
item('PLANT', 6, 17);
item('PLANT_2', 12, 17);
item('LARGE_PLANT', 15, 17);
// A sunken-looking terracotta lounge with a coffee island.
item('SOFA_FRONT', 24, 14, undefined, terracotta);
item('SOFA_SIDE', 22, 15, undefined, terracotta);
item('SOFA_SIDE:left', 27, 15, undefined, terracotta);
item('COFFEE_TABLE', 24, 15);
item('COFFEE', 24, 15);
item('PLANT_2', 28, 12);
item('SMALL_TABLE_FRONT', 23, 19);
item('COFFEE', 23, 19);
item('POT', 24, 19);
item('CACTUS', 28, 18);
fs.writeFileSync(
  path.join(assets, 'default-layout-2.json'),
  JSON.stringify(layout, null, 2) + '\n',
);
console.log(
  `Packed ${names.length} animated mascot sheets and ${cols}x${rows} studio (${layout.furniture.length} furniture items).`,
);
