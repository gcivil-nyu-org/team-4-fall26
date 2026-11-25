// What the site actually asks of each web font, read from rendered pages.
//
//   node qa/fonts/usage.mjs [base-url] > qa/fonts/usage.json
//
// Visits every route (and scrolls each to the bottom, so lazy sections render),
// walks every text node and every ::before/::after with content, and records per
// font family: the characters drawn, the weights and styles, font-variation-settings,
// the OpenType features turned on (font-feature-settings and font-variant-*), the
// font sizes (for optical size), and whether `hyphens: auto` could add U+2010.
// Also lists which font files each page downloaded. Text is credited to the first
// family in the computed font-family list that the page declares with @font-face or
// loads from Google Fonts; system fallbacks are ignored.
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:7600';
const ROUTES = [
	'/',
	'/communities',
	'/board',
	'/messages',
	'/account',
	'/signup',
	'/favourites',
	'/people',
	'/spots/dohmh:40365904'
];

const browser = await chromium.launch({
	executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
	args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
});
const result = { families: {}, pages: {} };

for (const route of ROUTES) {
	for (const width of [1440, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 900 } });
		const fonts = new Set();
		page.on('response', (response) => {
			if (response.request().resourceType() === 'font')
				fonts.add(response.url().replace(/^https?:\/\/[^/]+/, ''));
		});
		await page.goto(base + route, { waitUntil: 'load' });
		await page.evaluate(async () => {
			for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
				scrollTo(0, y);
				await new Promise((resolve) => setTimeout(resolve, 120));
			}
		});
		await page.waitForTimeout(1500);
		const found = await page.evaluate(() => {
			const declared = new Set();
			for (const face of document.fonts) declared.add(face.family.replace(/["']/g, ''));
			const out = {};
			const record = (style, text) => {
				const family = style.fontFamily
					.split(',')
					.map((name) => name.trim().replace(/["']/g, ''))
					.find((name) => declared.has(name));
				if (!family || !text.trim()) return;
				const transformed =
					style.textTransform === 'uppercase'
						? text.toUpperCase()
						: style.textTransform === 'lowercase'
							? text.toLowerCase()
							: text;
				const entry = (out[family] ??= {
					chars: '',
					weights: [],
					styles: [],
					variations: [],
					features: [],
					sizes: [],
					hyphens: false
				});
				entry.chars += transformed;
				const add = (list, value) => {
					if (!list.includes(value)) list.push(value);
				};
				add(entry.weights, style.fontWeight);
				add(entry.styles, style.fontStyle);
				add(entry.sizes, Math.round(parseFloat(style.fontSize)));
				if (style.fontVariationSettings !== 'normal')
					add(entry.variations, style.fontVariationSettings);
				for (const [property, value] of [
					['feature', style.fontFeatureSettings],
					['numeric', style.fontVariantNumeric],
					['caps', style.fontVariantCaps],
					['ligatures', style.fontVariantLigatures],
					['east-asian', style.fontVariantEastAsian],
					['position', style.fontVariantPosition],
					['kerning', style.fontKerning],
					['optical-sizing', style.fontOpticalSizing]
				])
					if (value && value !== 'normal' && value !== 'auto') add(entry.features, `${property}:${value}`);
				if (style.hyphens === 'auto') entry.hyphens = true;
			};
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const element = node.parentElement;
				if (!element || element.closest('script, style')) continue;
				record(getComputedStyle(element), node.textContent);
			}
			for (const element of document.body.querySelectorAll('*')) {
				for (const pseudo of ['::before', '::after']) {
					const style = getComputedStyle(element, pseudo);
					const content = style.content;
					if (content && content.startsWith('"')) record(style, JSON.parse(content));
				}
				for (const attribute of ['placeholder', 'value']) {
					const value = element.getAttribute(attribute);
					if (value && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'))
						record(getComputedStyle(element), value);
				}
			}
			return out;
		});
		result.pages[`${route} @${width}`] = [...fonts].sort();
		for (const [family, entry] of Object.entries(found)) {
			const merged = (result.families[family] ??= {
				chars: new Set(),
				weights: new Set(),
				styles: new Set(),
				variations: new Set(),
				features: new Set(),
				sizes: new Set(),
				hyphens: false,
				pages: new Set()
			});
			for (const char of entry.chars) merged.chars.add(char);
			for (const key of ['weights', 'styles', 'variations', 'features', 'sizes'])
				for (const value of entry[key]) merged[key].add(value);
			merged.hyphens ||= entry.hyphens;
			merged.pages.add(route);
		}
		await page.close();
	}
}
await browser.close();

const codepoints = (chars) =>
	[...chars]
		.map((char) => char.codePointAt(0))
		.sort((a, b) => a - b)
		.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
const report = { pages: result.pages, families: {} };
for (const [family, entry] of Object.entries(result.families)) {
	const chars = [...entry.chars].filter((char) => char.trim()).sort();
	report.families[family] = {
		chars: chars.join(''),
		nonAscii: codepoints(chars.filter((char) => char.codePointAt(0) > 0x7e)),
		weights: [...entry.weights].sort(),
		styles: [...entry.styles].sort(),
		variations: [...entry.variations].sort(),
		features: [...entry.features].sort(),
		sizes: [...entry.sizes].sort((a, b) => a - b),
		hyphens: entry.hyphens,
		pages: [...entry.pages].sort()
	};
}
console.log(JSON.stringify(report, null, '\t'));
