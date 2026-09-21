# Little Studio

Nine Claude-inspired orange mascots and a warm, editable studio office.

## Use

- Run `npm start` from the repository to start the built standalone app. Open the URL printed by the server and run Claude Code in a terminal in the workspace you want to watch. The original hooks/transcript integration is unchanged.
- Run `npm run studio:preview`, then open `http://127.0.0.1:5173/?studio=1` for the sandbox with nine simulated agents. Layout, pets, mascot assignments, and display settings persist in this browser's local storage. This preview does not run Claude or perform real tasks; live-only settings are unavailable. A port already in use may make Vite choose another port; use its printed address with `?studio=1`.
- Click **Mascots**, choose an agent from the dropdown, then choose its identity. Clicking an agent on the map also selects it. Live mode saves the selection through the existing agent-seat persistence channel; subagents inherit the parent's choice.
- Click **Layout** to move furniture, paint floors, and edit the office normally.
- After source edits, run `npm run build`. `npm run studio:assets` repacks the source artwork and rebuilds the bundled layout; it intentionally overwrites the nine bundled character sheets and layout revision 2.

## Artwork

`mascot-turnarounds.png` is the generated source atlas (built-in image generation, no API CLI). Columns: Detective, Wizard, Lo-fi, Chef, Astronaut, Gardener. Rows: front, back, right. This was generated using the user's supplied mascots as a visual design reference, with additional astronaut and gardener identities.

`mascot-turnarounds-extra.png` is the second generated atlas, with Robot, Artist, and Pilot columns and front, back, right rows. Both atlases were created using the imagegen skill and built-in image generation, then packed into animated game assets.

The engine-ready sheets are `webview-ui/public/assets/characters/char_0.png` through `char_8.png`. Each sheet is 224×96, with seven 32×32 frames in each of three directional rows. Frames 0–2 walk, 3–4 work, and 5–6 read. Left-facing frames are mirrored by the existing engine. Transparent padding is cropped, proportions are preserved, and nearest-neighbor sampling packs the artwork. The packing script adds alternating steps and work/book beats. The decoder continues to accept the original 112×96 human character format.

The original six characters are backed up under `original-characters/`. The old map remains `webview-ui/public/assets/default-layout-1.json`; the new map is `default-layout-2.json`. Upstream's existing layout-revision mechanism installs the new map on launch, including replacing a saved older-revision layout. Export an old customized layout first if you want to retain it.

`office-before.png`, `office-after.png`, and `mascot-picker.png` are actual browser captures. The after capture uses simulated preview agents. The map is composed from the project's existing tiles and furniture, with a new layout, rugs, recoloring, desk positions, meeting nook, and coffee lounge; it is not a flattened background image.

## Verification

`npm run test:webview` covers the wide and legacy character decoders, complete animation frames, furniture bounds, every seat's path from the main aisle, and mascot selection persistence data. With the preview server on port 5173 and a completed build, `npx tsx scripts/verify-claude-studio.ts` checks the UI in Edge and starts an isolated production server to verify the actual WebSocket asset delivery. This production check uses a temporary profile under ignored `test-results/`; it does not grant hooks consent or use real Claude sessions.

`npx tsx scripts/verify-studio-controls.ts` checks furniture placement and erasing, floor/wall/carpet/area painting, undo/redo, pets, display settings, all nine mascots, and persistence after reloading. It uses an isolated browser context and does not modify the user's saved office. `nine-mascots.png` is an actual browser capture of the expanded roster.

## Final generation prompt

Use case: stylized-concept. Asset type: production pixel-art game character turnaround atlas, a single sprite atlas image. Generate six different cute Claude Code inspired coral-orange block/crab mascots. All have the same squat square orange body, two tiny vertical black eyes, small side arms, four stubby feet, dark terracotta edge shadows. Style like a real 16-bit pixel game, strictly crisp chunky square pixel art with only 8-12 colors per character, NO smooth curves, NO anti-aliasing, NO gradients, NO texture, NO ground shadow. Transparent background with true alpha. EXACT composition: a regular grid of SIX columns and THREE rows, 18 separate sprites total, equal-sized cells. Canvas landscape 1536x768 (2:1), each cell 256x256. Every sprite must stay within its cell with 32 pixels transparent padding on every side. Same feet baseline in every cell, same body scale. Columns left to right identify characters: 1 detective with brown deerstalker cap and tiny magnifying glass; 2 wizard with blue pointed hat and pale gold hatband; 3 music coder with navy headphones; 4 chef with white toque; 5 astronaut with small white helmet with blue visor leaving orange face visible; 6 gardener with straw hat and little green leaf. ROW 1: all six mascots face forward, with their two black eyes visible. ROW 2: the SAME six mascots seen from the BACK, same hats/accessories but NO eyes. ROW 3: the SAME six mascots in RIGHT-facing side profile, one eye at right. Every character has the SAME squat silhouette and cute orange body. Their feet are visible in every view. Tiny, simple game sprite details readable when reduced to 16 pixels wide. No text, labels, grid lines, decorative objects, white backdrop, ground or border. This is a single cohesive technical sprite sheet, NOT an illustration or reference board.

The delivered atlas has a transparent background at 1774×887. The packing script uses its actual dimensions; no grid size is assumed from the requested output resolution.

## Extra mascots: final generation prompt

Use case: stylized-concept. Asset: ONE production game sprite turnaround atlas containing three Claude Code inspired coral-orange block/crab mascots in a strict 3-column by 3-row grid. Transparent background with true alpha. Square canvas. Equal square cells. At least 12% transparent padding in each cell. All mascots share a squat square orange body, two tall black rectangular eyes, two tiny side arms and four stubby feet; dark terracotta outlines and orange highlights. Match a cute chunky 16-bit pixel game sprite: crisp pixel steps, no gradients, no shadows outside sprite, no smooth curves, no text. COLUMN 1: ROBOT mascot, metallic gray square ear attachments, little cyan antenna on top, orange face/body visible, tiny cyan chest badge. COLUMN 2: ARTIST mascot, purple beret, little paintbrush held beside the body, orange body. COLUMN 3: PILOT mascot, brown leather aviator cap and blue goggles worn on forehead, cream scarf, orange face/body visible. ROW 1: front-facing, two eyes visible. ROW 2: back-facing matching same hats and gear, no eyes on back. ROW 3: RIGHT-facing side profile with one visible black eye at right. Exactly NINE isolated sprites. Same scale and feet baseline in every cell, fit sprites entirely inside their cell. Each character should be recognizable at 26 pixels wide by 28 pixels tall. This is a game asset, no backdrop, no checkerboard, no grid lines or labels. Orange body should occupy about 55% of sprite height, outfits only accessories.
