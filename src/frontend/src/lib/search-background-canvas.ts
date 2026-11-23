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
const tileWidth = 122;
const tileHeight = 86;
const textureWidth = tileWidth * 16;
const textureHeight = tileHeight * 8;

function grain(x: number, y: number) {
	const seed = Math.imul(x, 374761393) + Math.imul(y, 668265263);
	return (Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0) / 4294967296;
}

function shape(x: number, y: number, kind: number) {
	const ax = Math.abs(x);
	const ay = Math.abs(y);
	switch (kind) {
		case 0:
		case 1:
			return true;
		case 2:
			return ax + ay < 0.9;
		case 3:
			return ax + ay > 0.72;
		case 4:
			return Math.abs(x - y * 0.8) < 0.4;
		case 5:
			return Math.min(ax, ay) > 0.2;
		case 6:
			return Math.abs(ax - ay) < 0.19;
		default:
			return (ax - 0.33) ** 2 + ((ay - 0.31) * 1.18) ** 2 < 0.1;
	}
}

function makeArtwork() {
	const image = new Uint8Array(textureWidth * textureHeight * 3);
	for (let row = 0; row < textureHeight / tileHeight; row++) {
		for (let col = 0; col < textureWidth / tileWidth; col++) {
			const primary = Math.floor(grain(col + 17, row + 19) * palette.length);
			const secondary = (primary + 1 + Math.floor(grain(col + 3, row + 8) * 4)) % palette.length;
			const kind = Math.floor(grain(col + 42, row + 35) * 8);
			const brightness = 0.63 + grain(col + 14, row + 55) * 0.37;
			for (let y = 0; y < 64; y++) {
				for (let x = 0; x < 100; x++) {
					const shown = shape(x / 50 - 1, y / 32 - 1, kind);
					const accent = grain(col * 4 + (x >> 5), row * 4 + (y >> 4)) > 0.78;
					const color = palette[accent ? secondary : primary];
					const amount = shown ? brightness : brightness * 0.065;
					const i = ((row * tileHeight + y + 11) * textureWidth + col * tileWidth + x + 11) * 3;
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
				frame.data[pixel] =
					(art[near] * 0.34 + art[middle] * 0.41 + art[far] * 0.25) * 1.18;
				frame.data[pixel + 1] =
					(art[near + 1] + art[middle + 1] * 2 + art[far + 1]) * 0.3;
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
