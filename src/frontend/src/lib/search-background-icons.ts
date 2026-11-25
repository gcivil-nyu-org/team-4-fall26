/*
	The motifs woven into the search background: New York, and symmetric
	figures from mathematics.
	Each is drawn in a 100 x 100 box in two inks -- the tile's main colour
	and its accent -- and may cut holes back out. Lines stay thick, because
	the background shows every icon only about sixteen ink strokes across.
*/

type Ink = 'main' | 'accent' | 'cut';
type Pen = CanvasRenderingContext2D;
export type Icon = (g: Pen) => void;

/** Main ink lands in the red channel, accent in green. */
export const MAIN_INK = '#f00';
export const ACCENT_INK = '#0f0';

function use(g: Pen, ink: Ink) {
	g.globalCompositeOperation = ink === 'cut' ? 'destination-out' : 'source-over';
	g.fillStyle = g.strokeStyle = ink === 'accent' ? ACCENT_INK : MAIN_INK;
}

function trace(g: Pen, points: readonly number[]) {
	g.beginPath();
	g.moveTo(points[0], points[1]);
	for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
}

function polygon(g: Pen, ink: Ink, points: readonly number[]) {
	use(g, ink);
	trace(g, points);
	g.closePath();
	g.fill();
}

function line(g: Pen, ink: Ink, width: number, points: readonly number[]) {
	use(g, ink);
	g.lineWidth = width;
	trace(g, points);
	g.stroke();
}

function circle(g: Pen, ink: Ink, x: number, y: number, r: number, width = 0) {
	use(g, ink);
	g.beginPath();
	g.arc(x, y, r, 0, Math.PI * 2);
	if (width) {
		g.lineWidth = width;
		g.stroke();
	} else g.fill();
}

/** The upper half of a disc. */
function dome(g: Pen, ink: Ink, x: number, y: number, r: number) {
	use(g, ink);
	g.beginPath();
	g.arc(x, y, r, Math.PI, Math.PI * 2);
	g.closePath();
	g.fill();
}

/** A free-form path, filled or stroked. */
function path(g: Pen, ink: Ink, build: (g: Pen) => void, width = 0) {
	use(g, ink);
	g.beginPath();
	build(g);
	if (width) {
		g.lineWidth = width;
		g.stroke();
	} else g.fill();
}

/** A parametric curve over t in [0, 1]. */
function curve(
	g: Pen,
	ink: Ink,
	at: (t: number) => readonly [number, number],
	width = 0,
	rule: CanvasFillRule = 'nonzero'
) {
	use(g, ink);
	g.beginPath();
	for (let i = 0; i <= 360; i++) {
		const [x, y] = at(i / 360);
		if (i) g.lineTo(x, y);
		else g.moveTo(x, y);
	}
	if (width) {
		g.lineWidth = width;
		g.stroke();
	} else {
		g.closePath();
		g.fill(rule);
	}
}

/* New York */

const waterTower: Icon = (g) => {
	line(g, 'main', 6, [34, 60, 25, 96]);
	line(g, 'main', 6, [66, 60, 75, 96]);
	line(g, 'main', 6, [50, 60, 50, 96]);
	line(g, 'main', 4, [30, 80, 70, 80]);
	polygon(g, 'main', [30, 30, 70, 30, 70, 62, 30, 62]);
	line(g, 'cut', 3, [30, 41, 70, 41]);
	line(g, 'cut', 3, [30, 51, 70, 51]);
	polygon(g, 'accent', [24, 31, 50, 8, 76, 31]);
	circle(g, 'accent', 50, 7, 4);
};

const chrysler: Icon = (g) => {
	polygon(g, 'main', [34, 64, 66, 64, 66, 100, 34, 100]);
	for (const x of [42, 50, 58]) line(g, 'cut', 3, [x, 70, x, 100]);
	dome(g, 'main', 50, 64, 31);
	dome(g, 'accent', 50, 64, 24);
	dome(g, 'main', 50, 64, 17);
	dome(g, 'accent', 50, 64, 10);
	for (const angle of [200, 230, 260, 280, 310, 340])
		circle(
			g,
			'cut',
			50 + Math.cos((angle * Math.PI) / 180) * 27.5,
			64 + Math.sin((angle * Math.PI) / 180) * 27.5,
			2.4
		);
	polygon(g, 'main', [46, 50, 50, 1, 54, 50]);
};

const bridge: Icon = (g) => {
	path(
		g,
		'accent',
		(p) => {
			p.moveTo(26, 18);
			p.quadraticCurveTo(12, 62, -4, 92);
			p.moveTo(74, 18);
			p.quadraticCurveTo(88, 62, 104, 92);
		},
		4
	);
	polygon(g, 'main', [25, 14, 75, 14, 79, 98, 21, 98]);
	line(g, 'main', 7, [19, 13, 81, 13]);
	for (const x of [29, 53]) {
		path(g, 'cut', (p) => {
			p.moveTo(x, 92);
			p.lineTo(x, 48);
			p.quadraticCurveTo(x, 34, x + 9, 28);
			p.quadraticCurveTo(x + 18, 34, x + 18, 48);
			p.lineTo(x + 18, 92);
			p.closePath();
		});
	}
	line(g, 'accent', 6, [0, 76, 100, 76]);
};

const bullet =
	(letter: readonly (readonly number[])[]): Icon =>
	(g) => {
		circle(g, 'main', 50, 50, 44);
		circle(g, 'accent', 50, 50, 44, 5);
		for (const stroke of letter) line(g, 'cut', 11, stroke);
	};

const pretzel: Icon = (g) => {
	path(
		g,
		'main',
		(p) => {
			p.moveTo(30, 78);
			p.bezierCurveTo(44, 66, 64, 50, 50, 30);
			p.bezierCurveTo(40, 10, 8, 12, 8, 42);
			p.bezierCurveTo(8, 72, 32, 92, 50, 92);
			p.bezierCurveTo(68, 92, 92, 72, 92, 42);
			p.bezierCurveTo(92, 12, 60, 10, 50, 30);
			p.bezierCurveTo(36, 50, 56, 66, 70, 78);
		},
		11
	);
	for (const [x, y] of [
		[16, 30],
		[84, 52],
		[40, 88],
		[70, 20],
		[22, 66]
	])
		circle(g, 'accent', x, y, 3);
};

const hydrant: Icon = (g) => {
	polygon(g, 'main', [44, 10, 56, 10, 56, 22, 44, 22]);
	dome(g, 'main', 50, 36, 17);
	polygon(g, 'main', [34, 36, 66, 36, 66, 88, 34, 88]);
	line(g, 'cut', 3, [33, 40, 67, 40]);
	polygon(g, 'main', [27, 86, 73, 86, 73, 96, 27, 96]);
	polygon(g, 'accent', [18, 50, 34, 50, 34, 64, 18, 64]);
	polygon(g, 'accent', [66, 50, 82, 50, 82, 64, 66, 64]);
	circle(g, 'accent', 50, 60, 7);
};

/* Symmetric figures */

const lemniscate: Icon = (g) =>
	curve(
		g,
		'main',
		(t) => {
			const a = t * Math.PI * 2;
			const d = 1 + Math.sin(a) ** 2;
			return [50 + (44 * Math.cos(a)) / d, 50 + (44 * Math.sin(a) * Math.cos(a)) / d];
		},
		10
	);

const rose =
	(petals: 3 | 4): Icon =>
	(g) => {
		const k = petals === 3 ? 3 : 2;
		const span = petals === 3 ? Math.PI : Math.PI * 2;
		curve(g, 'main', (t) => {
			const a = t * span;
			const r = 46 * Math.cos(k * a);
			return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
		});
		circle(g, 'accent', 50, 50, petals === 3 ? 8 : 10);
	};

const lissajous: Icon = (g) =>
	curve(
		g,
		'main',
		(t) => [
			50 + 42 * Math.sin(3 * t * Math.PI * 2 + Math.PI / 2),
			50 + 42 * Math.sin(2 * t * Math.PI * 2)
		],
		6
	);

const seedOfLife: Icon = (g) => {
	circle(g, 'accent', 50, 50, 43, 5);
	circle(g, 'main', 50, 50, 21, 5);
	for (let i = 0; i < 6; i++) {
		const a = (i * Math.PI) / 3;
		circle(g, 'main', 50 + Math.cos(a) * 21, 50 + Math.sin(a) * 21, 21, 5);
	}
};

const octagram: Icon = (g) => {
	const at = (i: number) => {
		const a = (i * 3 * Math.PI) / 4 - Math.PI / 2;
		return [50 + Math.cos(a) * 46, 50 + Math.sin(a) * 46];
	};
	use(g, 'main');
	trace(g, Array.from({ length: 8 }, (_, i) => at(i)).flat());
	g.closePath();
	g.fill('evenodd');
	circle(g, 'accent', 50, 50, 12);
};

const koch: Icon = (g) => {
	let points: [number, number][] = [0, 1, 2].map((i) => {
		const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
		return [50 + Math.cos(a) * 40, 54 + Math.sin(a) * 40];
	});
	for (let level = 0; level < 2; level++) {
		const next: [number, number][] = [];
		points.forEach(([x1, y1], i) => {
			const [x2, y2] = points[(i + 1) % points.length];
			const dx = (x2 - x1) / 3;
			const dy = (y2 - y1) / 3;
			const ax = x1 + dx;
			const ay = y1 + dy;
			next.push(
				[x1, y1],
				[ax, ay],
				[ax + dx / 2 + dy * 0.866, ay + dy / 2 - dx * 0.866],
				[ax + dx, ay + dy]
			);
		});
		points = next;
	}
	polygon(g, 'main', points.flat());
	circle(g, 'accent', 50, 54, 13);
};

export const ICONS: readonly Icon[] = [
	waterTower,
	chrysler,
	bridge,
	bullet([
		[30, 78, 50, 22, 70, 78],
		[38, 60, 62, 60]
	]),
	bullet([[30, 26, 70, 26, 44, 80]]),
	bullet([[37, 22, 37, 76, 68, 76]]),
	pretzel,
	hydrant,
	lemniscate,
	rose(3),
	rose(4),
	lissajous,
	seedOfLife,
	octagram,
	koch
];
