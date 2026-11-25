import { ICONS, type Icon } from './search-background-icons';

export type Point = { x: number; y: number };
export type Stroke = { from: Point; to: Point; direction: Point; strength: number };

const background = '#1d170d';
const palette = [
	[224, 42, 77],
	[249, 94, 18],
	[242, 166, 43],
	[235, 188, 132],
	[242, 228, 212],
	[170, 55, 223],
	[214, 146, 240],
	[113, 138, 194]
];
/** Each icon is drawn this many pixels square, inside a slightly larger tile. */
const iconSize = 140;
const tileWidth = 176;
const tileHeight = 164;
const tileColumns = 12;
const tileRows = 5;
const textureWidth = tileWidth * tileColumns;
const textureHeight = tileHeight * tileRows;

function grain(x: number, y: number) {
	const seed = Math.imul(x, 374761393) + Math.imul(y, 668265263);
	return (Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0) / 4294967296;
}

/** Each icon's pixels: 0 for empty, 1 for main ink, 2 for accent. */
function rasterise(icon: Icon) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = iconSize;
	const g = canvas.getContext('2d', { willReadFrequently: true });
	const inks = new Uint8Array(iconSize * iconSize);
	if (!g) return inks;
	g.scale(iconSize / 100, iconSize / 100);
	g.lineCap = 'round';
	g.lineJoin = 'round';
	icon(g);
	const { data } = g.getImageData(0, 0, iconSize, iconSize);
	for (let i = 0; i < inks.length; i++) {
		if (data[i * 4 + 3] < 128) continue;
		inks[i] = data[i * 4 + 1] > data[i * 4] ? 2 : 1;
	}
	return inks;
}

/** A shuffled deck, so every icon turns up before any repeats. */
function deal(count: number) {
	const order: number[] = [];
	while (order.length < tileColumns * tileRows) {
		const round = Array.from({ length: count }, (_, i) => i);
		for (let i = round.length - 1; i > 0; i--) {
			const j = Math.floor(grain(order.length + i, 91) * (i + 1));
			[round[i], round[j]] = [round[j], round[i]];
		}
		order.push(...round);
	}
	return order;
}

function makeArtwork() {
	const image = new Uint8Array(textureWidth * textureHeight * 3);
	const inks = ICONS.map(rasterise);
	const order = deal(ICONS.length);
	const inset = { x: (tileWidth - iconSize) >> 1, y: (tileHeight - iconSize) >> 1 };
	for (let row = 0; row < tileRows; row++) {
		for (let col = 0; col < tileColumns; col++) {
			const icon = inks[order[row * tileColumns + col]];
			const primary = Math.floor(grain(col + 17, row + 19) * palette.length);
			const secondary = (primary + 1 + Math.floor(grain(col + 3, row + 8) * 4)) % palette.length;
			const brightness = 0.63 + grain(col + 14, row + 55) * 0.37;
			for (let y = 0; y < iconSize; y++) {
				for (let x = 0; x < iconSize; x++) {
					// The renderer samples the texture bottom-up, so icons go in upside down.
					const ink = icon[(iconSize - 1 - y) * iconSize + x];
					const color = palette[ink === 2 ? secondary : primary];
					const amount = ink ? brightness : brightness * 0.065;
					const i =
						((row * tileHeight + y + inset.y) * textureWidth + col * tileWidth + x + inset.x) * 3;
					image[i] = color[0] * amount;
					image[i + 1] = color[1] * amount;
					image[i + 2] = color[2] * amount;
				}
			}
		}
	}
	return image;
}

// Project the artwork and solve the wake at glyph resolution, then apply the fixed ink mask.
export function createCanvasSearchBackgroundRenderer(canvas: HTMLCanvasElement) {
	const context = canvas.getContext('2d');
	const mask = document.createElement('canvas');
	const maskContext = mask.getContext('2d');
	const colors = document.createElement('canvas');
	const colorsContext = colors.getContext('2d');
	if (!context || !maskContext || !colorsContext) return;

	const ctx = context;
	const ink = maskContext;
	const cells = colorsContext;
	const art = makeArtwork();
	let width = 1;
	let height = 1;
	let columns = 1;
	let rows = 1;
	let frame = cells.createImageData(1, 1);
	let wakeX = new Float32Array(1);
	let wakeY = new Float32Array(1);
	let wakeDensity = new Float32Array(1);

	function resize(cssWidth: number, cssHeight: number, dpi: number) {
		width = Math.max(1, cssWidth);
		height = Math.max(1, cssHeight);
		canvas.width = mask.width = Math.max(1, Math.round(width * dpi));
		canvas.height = mask.height = Math.max(1, Math.round(height * dpi));
		const size = Math.max(0.72, Math.min(1, width / 1100));
		columns = colors.width = Math.max(1, Math.round(width / (8.75 * size)));
		rows = colors.height = Math.max(1, Math.round(height / (8 * size)));
		frame = cells.createImageData(columns, rows);
		wakeX = new Float32Array(columns * rows);
		wakeY = new Float32Array(columns * rows);
		wakeDensity = new Float32Array(columns * rows);

		const texture = ink.createImageData(mask.width, mask.height);
		for (let y = 0; y < mask.height; y++) {
			const wave = Math.sin(((y * rows) / mask.height) * 11) * 0.04;
			for (let x = 0; x < mask.width; x++) {
				const position = (x * columns) / mask.width;
				const noise = grain(x + 7, y + 11);
				const distance = Math.abs(
					position - Math.floor(position) - 0.49 - wave - (noise - 0.5) * 0.16
				);
				if (distance > 0.14 || noise < 0.22) continue;
				const opacity = Math.min(1, (0.14 - distance) / 0.1) * (0.35 + 0.65 * noise);
				texture.data[(y * mask.width + x) * 4 + 3] = opacity * 255;
			}
		}
		ink.putImageData(texture, 0, 0);
		ctx.imageSmoothingEnabled = false;
	}

	function clearWake() {
		wakeX.fill(0);
		wakeY.fill(0);
		wakeDensity.fill(0);
	}

	function indexAt(x: number, y: number) {
		const col = ((Math.floor(x) % textureWidth) + textureWidth) % textureWidth;
		const row = ((Math.floor(y) % textureHeight) + textureHeight) % textureHeight;
		return (row * textureWidth + col) * 3;
	}

	function draw(time: number, delta: number, stroke?: Stroke) {
		const decay = 0.93 ** (delta * 30);
		const scale = Math.max(0.66, Math.min(1, width / 1100));
		const travel = (time * 52) % textureWidth;
		const radius = stroke ? 94 + stroke.strength * 72 : 1;
		const moveX = stroke ? stroke.to.x - stroke.from.x : 0;
		const moveY = stroke ? stroke.to.y - stroke.from.y : 0;
		const lengthSquared = Math.max(1, moveX * moveX + moveY * moveY);
		for (let row = 0; row < rows; row++) {
			const y = height * (1 - (row + 0.5) / rows);
			const centeredY = y / height - 0.5;
			for (let col = 0; col < columns; col++) {
				const x = (width * (col + 0.5)) / columns;
				const centeredX = x / width - 0.5;
				const cell = row * columns + col;
				let density = Math.max(0, wakeDensity[cell] * decay - 0.004);
				let directionX = wakeX[cell] * decay;
				let directionY = wakeY[cell] * decay;
				if (stroke) {
					const px = x - stroke.from.x;
					const py = y - stroke.from.y;
					const t = Math.max(0, Math.min(1, (px * moveX + py * moveY) / lengthSquared));
					const dx = px - t * moveX;
					const dy = py - t * moveY;
					const distance = dx * dx + dy * dy;
					if (distance < radius * radius) {
						const falloff = 1 - Math.sqrt(distance) / radius;
						const deposit = stroke.strength * falloff * falloff;
						density = Math.max(density, deposit);
						directionX += stroke.direction.x * deposit;
						directionY += stroke.direction.y * deposit;
					}
				}
				wakeDensity[cell] = density;
				wakeX[cell] = density ? directionX : 0;
				wakeY[cell] = density ? directionY : 0;

				const projectedX = (x * (1 + centeredY * centeredY * 0.06)) / scale + travel;
				const projectedY = y / scale + 5 * Math.sin(centeredX * 5 + time * 0.22);
				let near = indexAt(projectedX, projectedY);
				let middle = near;
				let far = near;
				if (density > 0.01) {
					const length = Math.hypot(directionX, directionY);
					if (length > 0.01) {
						const distance = (density * 235) / (length * scale);
						const dx = directionX * distance;
						const dy = directionY * distance;
						near = indexAt(projectedX - dx * 0.54, projectedY - dy * 0.54);
						middle = indexAt(projectedX - dx * 0.74, projectedY - dy * 0.74);
						far = indexAt(projectedX - dx * 0.95, projectedY - dy * 0.95);
					}
				}
				const edge = Math.hypot(centeredX * 0.62, centeredY);
				const vignette = Math.min(1, Math.max(0, (0.51 - edge) / 0.27));
				const pixel = cell * 4;
				frame.data[pixel] = (art[near] * 0.34 + art[middle] * 0.41 + art[far] * 0.25) * 1.18;
				frame.data[pixel + 1] = (art[near + 1] + art[middle + 1] * 2 + art[far + 1]) * 0.3;
				frame.data[pixel + 2] =
					(art[near + 2] * 0.25 + art[middle + 2] * 0.41 + art[far + 2] * 0.34) * 1.18;
				frame.data[pixel + 3] = vignette * 255;
			}
		}

		cells.putImageData(frame, 0, 0);
		ctx.globalCompositeOperation = 'copy';
		ctx.drawImage(colors, 0, 0, canvas.width, canvas.height);
		ctx.globalCompositeOperation = 'destination-in';
		ctx.drawImage(mask, 0, 0);
		ctx.globalCompositeOperation = 'destination-over';
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.globalCompositeOperation = 'source-over';
	}

	return { resize, clearWake, draw };
}
