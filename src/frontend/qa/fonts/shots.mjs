// Screenshots for the font before/after pixel diff.
//
//   node qa/fonts/shots.mjs <base-url> <out-dir>
//   uv run --with pillow python qa/pixeldiff.py <before>/<name>.png <after>/<name>.png
//
// For each page and width it scrolls a screen at a time, as a reader would, and shoots
// every step with the clock paused, so both builds are photographed in the same states.
// It also renders a probe on the homepage: every family, weight and style the site uses,
// setting ASCII, curly punctuation, Latin-1 and Latin Extended-A text, CJK (which falls
// back to system fonts), a code span, and bold inside italics.
//
// Only text is compared: pages are shot with reduced motion and with images, canvases,
// video and maps hidden, because those load and move on real time and differ between
// two runs of the same build.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
if (!base || !out) {
	console.error('usage: node qa/fonts/shots.mjs <base-url> <out-dir>');
	process.exit(2);
}
mkdirSync(out, { recursive: true });

const PAGES = [
	['home', '/'],
	['communities', '/communities'],
	['messages', '/messages']
];
const WIDTHS = [390, 1440];

const PROBE_TEXT = [
	'Hamburgefonstiv 0123456789 — “quoted” ‘single’ … – (a) [b] {c} @#$%&*',
	'Café Ñandú, Zoë’s naïve façade, Øresund, Æsir, ß, ©®™ € £ ¥ × ÷ ±',
	'Łódź, Šibenik, Ōkubo, Đorđe, Kraków, İstanbul, Œuvre, ŵ ŷ ĉ ĝ ĥ ĵ ŝ ŭ',
	'東京の図書館 · 서울 카페 · 北京咖啡馆',
	'→ ↑ ↓ − ∫ ★ ✳'
];
const PROBE_FACES = [
	['Inter', 300, 'normal'],
	['Inter', 400, 'normal'],
	['Inter', 500, 'normal'],
	['Inter', 600, 'normal'],
	['Inter', 700, 'normal'],
	['Inter', 900, 'normal'],
	['Inter Tight', 900, 'normal'],
	['__pixel__', 400, 'normal'],
	['Newsreader', 300, 'normal'],
	['Newsreader', 300, 'italic'],
	['Instrument Serif', 400, 'normal']
];

const browser = await chromium.launch({
	executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
	args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
});

for (const [name, path] of PAGES) {
	for (const width of WIDTHS) {
		const page = await browser.newPage({
			viewport: { width, height: 900 },
			reducedMotion: 'reduce'
		});
		await page.addInitScript(() => {
			const hide = () => {
				const style = document.createElement('style');
				style.textContent =
					'img, picture, canvas, video, iframe, svg image, .maplibregl-map { visibility: hidden !important; } * { caret-color: transparent !important; }';
				document.documentElement.append(style);
			};
			if (document.documentElement) hide();
			else addEventListener('DOMContentLoaded', hide);
		});
		await page.clock.install({ time: new Date('2026-11-25T12:00:00Z') });
		await page.clock.pauseAt(new Date('2026-11-25T12:00:01Z'));
		await page.goto(base + path, { waitUntil: 'load' });
		const height = await page.evaluate(() => document.documentElement.scrollHeight);
		for (let step = 0, y = 0; y < height; step++, y += 900) {
			await page.evaluate((top) => scrollTo(0, top), y);
			await page.clock.runFor(1200);
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.evaluate(() => document.fonts.ready);
			await page.clock.runFor(200);
			await page.screenshot({
				path: `${out}/${name}-${width}-${String(step).padStart(2, '0')}.png`
			});
		}
		await page.close();
	}
}

// The probe: the pixel font is named differently before and after (it had to be
// renamed), so it is looked up from the page's own declarations.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + '/', { waitUntil: 'load' });
await page.evaluate(
	({ faces, lines }) => {
		const pixel = [...document.fonts].find((face) => /Pixel|Press Start/.test(face.family));
		const probe = document.createElement('div');
		probe.id = 'font-probe';
		probe.style.cssText =
			'position:fixed;inset:0;z-index:99999;overflow:hidden;background:#fff;color:#111;padding:12px';
		for (const [family, weight, style] of faces) {
			const row = document.createElement('div');
			const name = family === '__pixel__' ? pixel.family.replace(/["']/g, '') : family;
			row.style.cssText = `font: ${style} ${weight} ${family === '__pixel__' ? 9 : 15}px/1.35 '${name}', serif; margin-bottom: 8px`;
			row.innerHTML = lines
				.map((line) => `<div>${line}</div>`)
				.concat(
					`<div><code style="font-family:inherit">const spot = "café";</code> <em>italic <b>bold in italic</b></em></div>`
				)
				.join('');
			probe.append(row);
		}
		document.body.append(probe);
	},
	{ faces: PROBE_FACES, lines: PROBE_TEXT }
);
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.locator('#font-probe').screenshot({ path: `${out}/probe.png` });
await browser.close();
console.log(out);
