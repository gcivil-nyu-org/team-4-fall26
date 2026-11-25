/**
 * A painted New York skyline, redrawn in characters.
 *
 * Two layers, after the ASCII explorations this is modelled on: a soft,
 * blurred painting underneath, and the subject -- the buildings, the sun and
 * their reflection -- traced over it in glyphs. Everything is generated from
 * a seed, so a scene is the same on every load and needs no image assets.
 */
export type Mood = 'dawn' | 'day' | 'dusk';

type Palette = {
	/** Sky, top to horizon. */
	sky: readonly [string, string, string];
	water: readonly [string, string];
	/** Sun glow as an `r g b` triple; it fades to its own colour, not to black. */
	glow: string;
	silhouette: string;
	ink: string;
	lit: string;
	/** Share of windows lit. */
	litRate: number;
	/** Sun centre and radius as fractions of the scene's width and height. */
	sun: { x: number; y: number; r: number };
	stars: boolean;
};

const PALETTES: Record<Mood, Palette> = {
	dawn: {
		sky: ['#c9d1e4', '#f1cdb8', '#f9e4c9'],
		water: ['#d9b9a6', '#9f8f98'],
		glow: '255 214 166',
		silhouette: '#8a7a86',
		ink: '#fff8ed',
		lit: '#ffe1ad',
		litRate: 0.12,
		sun: { x: 0.24, y: 0.3, r: 0.07 },
		stars: false
	},
	day: {
		sky: ['#8cb3d8', '#c5dbea', '#eef0e8'],
		water: ['#9fc0d4', '#5f7f96'],
		glow: '255 255 240',
		silhouette: '#6d8297',
		ink: '#ffffff',
		lit: '#fffbe8',
		litRate: 0.05,
		sun: { x: 0.78, y: 0.14, r: 0.05 },
		stars: false
	},
	dusk: {
		sky: ['#2a2441', '#a24f79', '#f29a61'],
		water: ['#7a3f5c', '#1e1729'],
		glow: '255 150 90',
		silhouette: '#291d2d',
		ink: '#f6dfe8',
		lit: '#ffcf7a',
		litRate: 0.36,
		sun: { x: 0.56, y: 0.5, r: 0.1 },
		stars: true
	}
};

/** Darkest to brightest. */
const RAMP = ' .,:;-=+*#%@';

/** Deterministic noise in 0..1 for an integer cell and a seed. */
function hash(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The ramp character for a brightness. */
function glyph(brightness: number): string {
	const clamped = Math.min(1, Math.max(0, brightness));
	return RAMP[Math.round(clamped * (RAMP.length - 1))];
}

const CELL_WIDTH = 7;
const CELL_HEIGHT = 12;
/** Where the land meets the water, as a fraction of the height. */
const HORIZON = 0.62;

type Building = { left: number; width: number; top: number; setback: number; spire: boolean };

/** A row of buildings across `cols` columns, standing on `horizon`. */
function skyline(cols: number, horizon: number, seed: number): Building[] {
	const buildings: Building[] = [];
	let left = -1;
	let i = 0;
	while (left < cols) {
		const width = 3 + Math.floor(hash(i, 1, seed) * 7);
		const tall = hash(i, 2, seed) > 0.86;
		const height = Math.round(
			horizon * (tall ? 0.62 + hash(i, 3, seed) * 0.12 : 0.16 + hash(i, 4, seed) * 0.34)
		);
		buildings.push({
			left,
			width,
			top: horizon - height,
			setback: tall || hash(i, 5, seed) > 0.6 ? Math.max(2, Math.round(height * 0.18)) : 0,
			spire: tall && width >= 5
		});
		left += width + (hash(i, 6, seed) > 0.7 ? 1 : 0);
		i++;
	}
	return buildings;
}

type Cell = { char: string; color: string; alpha: number };

/** The glyph a building puts in one cell, or null where the cell is sky. */
function buildingCell(
	b: Building,
	col: number,
	row: number,
	seed: number,
	palette: Palette
): Cell | null {
	const x = col - b.left;
	if (x < 0 || x >= b.width) return null;
	const centre = b.left + (b.width - 1) / 2;
	if (b.spire && Math.abs(col - centre) < 0.6 && row >= b.top - 4 && row < b.top - b.setback / 2) {
		return { char: '|', color: palette.ink, alpha: 0.9 };
	}
	// The upper storeys step in from both sides.
	const inset = row < b.top + b.setback ? 1 : 0;
	if (row < b.top || x < inset || x >= b.width - inset) {
		if (b.setback && row >= b.top - b.setback / 2 && row < b.top && x >= 1 && x < b.width - 1) {
			return { char: '^', color: palette.ink, alpha: 0.75 };
		}
		return null;
	}
	if (row === b.top || (inset && row === b.top + b.setback))
		return { char: '_', color: palette.ink, alpha: 0.8 };
	if (x === inset || x === b.width - 1 - inset)
		return { char: '|', color: palette.ink, alpha: 0.6 };
	if (x % 2 === 1 && row % 2 === 0) {
		const lit = hash(col, row, seed + 7) < palette.litRate;
		return lit
			? { char: hash(col, row, seed) > 0.5 ? '#' : '@', color: palette.lit, alpha: 1 }
			: { char: ':', color: palette.ink, alpha: 0.42 };
	}
	return { char: glyph(0.12 + hash(col, row, seed + 3) * 0.12), color: palette.ink, alpha: 0.32 };
}

/** Paint the whole scene into `context`, which is `width` by `height` CSS pixels. */
export function paintScene(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	mood: Mood,
	seed: number
): void {
	const palette = PALETTES[mood];
	const cols = Math.ceil(width / CELL_WIDTH);
	const rows = Math.ceil(height / CELL_HEIGHT);
	const horizon = Math.round(rows * HORIZON);
	const horizonY = horizon * CELL_HEIGHT;
	const buildings = skyline(cols, horizon, seed);
	const sun = { x: palette.sun.x * width, y: palette.sun.y * height, r: palette.sun.r * width };

	// The painting: sky, sun glow, water, and a blurred silhouette of the city.
	context.clearRect(0, 0, width, height);
	const sky = context.createLinearGradient(0, 0, 0, horizonY);
	palette.sky.forEach((color, i) => sky.addColorStop(i / (palette.sky.length - 1), color));
	context.fillStyle = sky;
	context.fillRect(0, 0, width, horizonY);
	const water = context.createLinearGradient(0, horizonY, 0, height);
	water.addColorStop(0, palette.water[0]);
	water.addColorStop(1, palette.water[1]);
	context.fillStyle = water;
	context.fillRect(0, horizonY, width, height - horizonY);

	const glow = context.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sun.r * 5);
	glow.addColorStop(0, `rgb(${palette.glow} / 80%)`);
	glow.addColorStop(1, `rgb(${palette.glow} / 0%)`);
	context.fillStyle = glow;
	context.fillRect(0, 0, width, height);

	context.save();
	context.filter = 'blur(10px)';
	context.fillStyle = palette.silhouette;
	context.globalAlpha = 0.55;
	for (const b of buildings) {
		context.fillRect(
			b.left * CELL_WIDTH,
			b.top * CELL_HEIGHT,
			b.width * CELL_WIDTH,
			horizonY - b.top * CELL_HEIGHT
		);
	}
	context.restore();

	// The subject, in characters.
	context.font = `${CELL_HEIGHT - 1}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';

	function draw(cell: Cell, col: number, row: number) {
		if (cell.char === ' ') return;
		context.globalAlpha = cell.alpha;
		context.fillStyle = cell.color;
		context.fillText(cell.char, (col + 0.5) * CELL_WIDTH, (row + 0.5) * CELL_HEIGHT);
	}

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const x = (col + 0.5) * CELL_WIDTH;
			const y = (row + 0.5) * CELL_HEIGHT;

			if (row < horizon) {
				let cell: Cell | null = null;
				for (const b of buildings) {
					cell = buildingCell(b, col, row, seed, palette);
					if (cell) break;
				}
				if (cell) {
					draw(cell, col, row);
					continue;
				}
				const distance = Math.hypot(x - sun.x, y - sun.y) / sun.r;
				if (distance < 1) {
					draw({ char: glyph(1 - distance * 0.55), color: palette.lit, alpha: 1 }, col, row);
				} else if (distance < 1.6 && hash(col, row, seed + 11) > 0.55) {
					draw({ char: '.', color: palette.lit, alpha: 0.7 }, col, row);
				} else if (palette.stars && row < horizon * 0.5 && hash(col, row, seed + 13) > 0.985) {
					draw(
						{ char: hash(col, row, seed) > 0.5 ? '+' : '.', color: palette.ink, alpha: 0.8 },
						col,
						row
					);
				}
				continue;
			}

			// The water: the city above, broken into ripples and fading with depth.
			const depth = (row - horizon) / Math.max(1, rows - horizon);
			const mirrored = horizon - 1 - (row - horizon);
			const sway = Math.round(Math.sin(row * 1.7 + seed) * 1.2);
			let reflected: Cell | null = null;
			for (const b of buildings) {
				reflected = buildingCell(b, col + sway, mirrored, seed, palette);
				if (reflected) break;
			}
			const sunDistance = Math.abs(x - sun.x) / (sun.r * (1.2 - depth * 0.6));
			if (reflected && hash(col, row, seed + 17) > 0.35 + depth * 0.4) {
				const lit = reflected.color === palette.lit;
				draw(
					{ char: lit ? '=' : '~', color: reflected.color, alpha: (lit ? 0.8 : 0.4) * (1 - depth) },
					col,
					row
				);
			} else if (sunDistance < 1 && hash(col, row, seed + 19) > 0.3) {
				draw(
					{ char: sunDistance < 0.5 ? '=' : '-', color: palette.lit, alpha: 0.85 - depth * 0.5 },
					col,
					row
				);
			} else if (hash(col, row, seed + 23) > 0.93) {
				draw({ char: '~', color: palette.ink, alpha: 0.25 }, col, row);
			}
		}
	}
	context.globalAlpha = 1;
}
