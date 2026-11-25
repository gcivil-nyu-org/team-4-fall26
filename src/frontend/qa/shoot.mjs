// Takes one reproducible screenshot of a page, for the before/after pairs in qa/NN-*/.
//
//   node qa/shoot.mjs <url> <out.png> [--width 1440] [--height 900] [--scroll 0]
//        [--via y] [--selector css] [--touch] [--reduced] [--firefox] [--wait 1500]
//
// The clock is installed and paused before the page loads, so the hero canvas, the
// spiral and every timer land on the same frame each run; time is then advanced by
// --wait ms before the shot. --scroll scrolls the window to that y first;
// --selector scrolls that element into view instead and shoots only it.
// Runs in the installed Google Chrome (CHROME, default /usr/bin/google-chrome), which
// draws the maps; see measure.mjs for why not Playwright's Chromium. --firefox swaps it.
import { chromium, firefox } from 'playwright';

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
	console.error('usage: node qa/shoot.mjs <url> <out.png> [options]');
	process.exit(2);
}
const flag = (name) => rest.includes(`--${name}`);
const option = (name, fallback) => {
	const index = rest.indexOf(`--${name}`);
	return index === -1 ? fallback : rest[index + 1];
};

const width = Number(option('width', 1440));
const height = Number(option('height', 900));
const touch = flag('touch');
const browser = await (flag('firefox')
	? firefox.launch()
	: chromium.launch({
			executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
			args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
		}));
const context = await browser.newContext({
	viewport: { width, height },
	hasTouch: touch,
	// Firefox has no mobile emulation; touch alone is the closest it gets.
	isMobile: touch && !flag('firefox'),
	deviceScaleFactor: 1,
	reducedMotion: flag('reduced') ? 'reduce' : 'no-preference'
});
const page = await context.newPage();
await page.clock.install({ time: new Date('2026-11-25T12:00:00Z') });
await page.clock.pauseAt(new Date('2026-11-25T12:00:01Z'));
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

// --via y stops at y first and lets the page settle there, the way a reader scrolling
// down arrives: sections that start loading a screen early get to do so.
const via = option('via', null);
if (via !== null) {
	await page.evaluate((y) => scrollTo(0, y), Number(via));
	await page.clock.runFor(1000);
	await page.waitForLoadState('networkidle').catch(() => {});
	await page.clock.runFor(500);
}

const selector = option('selector', null);
if (selector) await page.locator(selector).first().scrollIntoViewIfNeeded();
else await page.evaluate((y) => scrollTo(0, y), Number(option('scroll', 0)));

await page.clock.runFor(Number(option('wait', 1500)));
// Network work (images, fonts, API) runs on real time, not the paused clock.
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts.ready);
await page.clock.runFor(100);

await (selector ? page.locator(selector).first() : page).screenshot({ path: out });
await browser.close();
console.log(out);
