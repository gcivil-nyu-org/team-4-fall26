// Mechanical checks for the pages this pass polishes, at every width the brief names.
//
//   node qa/audit.mjs [base-url] > report.json
//
// For each page and width: horizontal overflow (and the elements causing it), tap
// targets under 44 px on touch widths, images without intrinsic dimensions, text
// below WCAG AA contrast against its painted background, console errors and
// warnings, and a keyboard pass that tabs through the page recording any focused
// element with no visible focus indicator. Contrast is computed against the first
// opaque background up the tree, so text over images or gradients is skipped.
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:7600';
const PAGES = ['/', '/communities', '/messages'];
const WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];
const TOUCH_BELOW = 1024;
const TABS = 60;

const browser = await chromium.launch({
	executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
	args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
});
const report = [];

for (const path of PAGES) {
	for (const width of WIDTHS) {
		const touch = width < TOUCH_BELOW;
		const context = await browser.newContext({
			viewport: { width, height: touch ? 844 : 900 },
			hasTouch: touch,
			isMobile: touch
		});
		const page = await context.newPage();
		const console_ = new Set();
		page.on('console', (message) => {
			if (['error', 'warning'].includes(message.type()))
				console_.add(`${message.type()}: ${message.text().slice(0, 200)}`);
		});
		page.on('pageerror', (error) => console_.add(`pageerror: ${error.message.slice(0, 200)}`));
		await page.goto(base + path, { waitUntil: 'load' });
		await page.evaluate(async () => {
			for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
				scrollTo(0, y);
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			scrollTo(0, 0);
		});
		await page.waitForTimeout(1500);

		const found = await page.evaluate(
			({ touch }) => {
				const describe = (element) => {
					const text = (element.getAttribute('aria-label') || element.textContent || '')
						.trim()
						.replace(/\s+/g, ' ')
						.slice(0, 40);
					const cls = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
					return `${element.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
				};
				const visible = (element) => {
					const style = getComputedStyle(element);
					const box = element.getBoundingClientRect();
					return (
						style.visibility !== 'hidden' &&
						style.display !== 'none' &&
						box.width > 0 &&
						box.height > 0 &&
						!element.closest('[inert], [aria-hidden="true"]')
					);
				};

				const root = document.documentElement;
				const overflow = [];
				if (root.scrollWidth > root.clientWidth + 1) {
					for (const element of document.body.querySelectorAll('*')) {
						const box = element.getBoundingClientRect();
						if (box.right > root.clientWidth + 1 && visible(element)) {
							let clipped = false;
							for (let up = element.parentElement; up; up = up.parentElement) {
								const o = getComputedStyle(up).overflowX;
								if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') {
									clipped = true;
									break;
								}
							}
							if (!clipped) overflow.push(`${describe(element)} right=${Math.round(box.right)}`);
						}
					}
				}

				const small = [];
				if (touch) {
					for (const element of document.querySelectorAll(
						'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
					)) {
						if (!visible(element)) continue;
						const box = element.getBoundingClientRect();
						if (box.width < 44 || box.height < 44)
							small.push(`${describe(element)} ${Math.round(box.width)}x${Math.round(box.height)}`);
					}
				}

				const unsized = [...document.images]
					.filter((image) => !image.getAttribute('width') || !image.getAttribute('height'))
					.filter((image) => !getComputedStyle(image).aspectRatio.includes('/'))
					.map((image) => `${describe(image)} ${image.src.slice(-50)}`);

				const parse = (value) => {
					const m = value.match(/rgba?\(([^)]+)\)/);
					if (!m) return null;
					const [r, g, b, a = 1] = m[1]
						.split(/[ ,/]+/)
						.filter(Boolean)
						.map(Number);
					return { r, g, b, a };
				};
				const luminance = ({ r, g, b }) => {
					const c = [r, g, b].map((v) => {
						v /= 255;
						return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
					});
					return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
				};
				const lowContrast = new Map();
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const element = node.parentElement;
					if (!element || !node.textContent.trim() || !visible(element)) continue;
					const style = getComputedStyle(element);
					const fg = parse(style.color);
					if (!fg || fg.a < 0.99 || Number(style.opacity) < 1) continue;
					let bg = null;
					let skip = false;
					for (let up = element; up; up = up.parentElement) {
						const s = getComputedStyle(up);
						if (s.backgroundImage !== 'none' || Number(s.opacity) < 1 || s.filter !== 'none') {
							skip = true;
							break;
						}
						const color = parse(s.backgroundColor);
						if (color && color.a >= 0.99) {
							bg = color;
							break;
						}
						if (color && color.a > 0) {
							skip = true;
							break;
						}
					}
					if (skip) continue;
					bg ??= { r: 255, g: 255, b: 255 };
					const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
					const ratio = (hi + 0.05) / (lo + 0.05);
					const size = parseFloat(style.fontSize);
					const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
					const needed = large ? 3 : 4.5;
					if (ratio < needed) {
						const key = `${describe(element)} ${ratio.toFixed(2)}:1 (needs ${needed}) ${style.color} on rgb(${bg.r},${bg.g},${bg.b})`;
						lowContrast.set(key, true);
					}
				}

				return {
					overflow: overflow.slice(0, 15),
					small,
					unsized,
					lowContrast: [...lowContrast.keys()]
				};
			},
			{ touch }
		);

		// Keyboard: tab through the page and flag any focused element without a
		// visible indicator (outline, box-shadow or a changed background/border).
		const unfocused = new Set();
		await page.evaluate(() => {
			scrollTo(0, 0);
			document.activeElement?.blur?.();
		});
		for (let i = 0; i < TABS; i++) {
			await page.keyboard.press('Tab');
			const result = await page.evaluate(() => {
				const element = document.activeElement;
				if (!element || element === document.body) return null;
				const focused = getComputedStyle(element);
				const indicator =
					(focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0) ||
					focused.boxShadow !== 'none';
				const box = element.getBoundingClientRect();
				const onScreen = box.bottom > 0 && box.top < innerHeight && box.width > 0;
				const text = (element.getAttribute('aria-label') || element.textContent || '')
					.trim()
					.replace(/\s+/g, ' ')
					.slice(0, 40);
				return {
					name: `${element.tagName.toLowerCase()} "${text}"`,
					indicator,
					onScreen
				};
			});
			if (!result) continue;
			if (!result.indicator) unfocused.add(`${result.name} (no outline/box-shadow)`);
			if (!result.onScreen) unfocused.add(`${result.name} (focused off screen)`);
		}

		report.push({
			path,
			width,
			touch,
			...found,
			focus: [...unfocused],
			console: [...console_]
		});
		await context.close();
	}
}
await browser.close();
console.log(JSON.stringify(report, null, '\t'));
