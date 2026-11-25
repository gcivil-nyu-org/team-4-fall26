// Measures the homepage the way qa/metrics.md reports it.
//
//   bun run build
//   TILES_PROXY_TARGET=https://d1ulyrfyi06kwp.cloudfront.net bunx vite preview --port 7600
//   node qa/measure.mjs [url] [label]   # prints one JSON line per profile
//
// Profiles: "desktop" (1440x900, no throttling) and "slow-3g" (390x844 touch phone,
// ~400 kbps / 400 ms RTT, 4x CPU slowdown). The cache is disabled in both.
//
// "load" is everything requested in the first 10 s without scrolling: what a visitor
// pays for before they choose to read on. "scrolled" adds a slow scroll to the bottom,
// which is where the below-the-fold sections should start spending.
//
// Runs in an installed Google Chrome (CHROME, default /usr/bin/google-chrome) rather
// than Playwright's bundled Chromium. On the machine this was written on, the bundled
// build has no WebGL2, so the maps never fetch tiles, and its GPU process stalls the
// first canvas call of every page for 6-15 s, which shows up as long tasks the
// site does not cause. Restart `vite preview` after each build: it keeps the old
// build's file list and 404s the new chunks.
import { chromium } from 'playwright';

const executablePath = process.env.CHROME ?? '/usr/bin/google-chrome';

const url = process.argv[2] ?? 'http://127.0.0.1:7600/';
const label = process.argv[3] ?? '';

const PROFILES = {
	desktop: { viewport: { width: 1440, height: 900 }, network: null, cpu: 1, touch: false },
	'slow-3g': {
		viewport: { width: 390, height: 844 },
		// CDP takes bytes per second; 400 kbit/s down, 400 kbit/s up, 400 ms latency.
		network: { latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 },
		cpu: 4,
		touch: true
	}
};

// Collected in the page from first paint, so nothing that happens before the
// script can attach is missed.
const OBSERVERS = () => {
	const vitals = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0, inp: 0 };
	window.__vitals = vitals;
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
	}).observe({ type: 'largest-contentful-paint', buffered: true });
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += entry.value;
	}).observe({ type: 'layout-shift', buffered: true });
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			vitals.longTasks += 1;
			vitals.longTaskMs += entry.duration;
		}
	}).observe({ type: 'longtask', buffered: true });
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries())
			if (entry.interactionId) vitals.inp = Math.max(vitals.inp, entry.duration);
	}).observe({ type: 'event', durationThreshold: 16, buffered: true });
};

function bucket(type, url) {
	if (/\.pmtiles/.test(url)) return 'tiles';
	if (type === 'Script') return 'js';
	if (type === 'Stylesheet') return 'css';
	if (type === 'Font') return 'font';
	if (type === 'Image') return 'image';
	if (type === 'Fetch' || type === 'XHR') return 'api';
	if (type === 'Document') return 'html';
	return 'other';
}

async function run(name, profile) {
	const browser = await chromium.launch({
		executablePath,
		// The real GPU: headless Chrome otherwise falls back to SwiftShader, which
		// does the GPU's work on the CPU and inflates every main-thread number.
		args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
	});
	const context = await browser.newContext({
		viewport: profile.viewport,
		hasTouch: profile.touch,
		isMobile: profile.touch,
		deviceScaleFactor: profile.touch ? 3 : 1
	});
	await context.addInitScript(OBSERVERS);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
	if (profile.network)
		await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });
	if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

	const types = new Map();
	const requests = [];
	let phase = 'load';
	cdp.on('Network.responseReceived', (event) =>
		types.set(event.requestId, { type: event.type, url: event.response.url })
	);
	cdp.on('Network.loadingFinished', (event) => {
		const meta = types.get(event.requestId);
		if (meta) requests.push({ ...meta, bytes: event.encodedDataLength, phase });
	});
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning')
			errors.push(`${message.type()}: ${message.text().slice(0, 160)}`);
	});
	page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 160)}`));

	await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
	await page.waitForTimeout(10_000);
	const atLoad = await page.evaluate(() => ({ ...window.__vitals }));

	phase = 'scrolled';
	await page.evaluate(async () => {
		const step = innerHeight / 2;
		for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
			scrollTo(0, y);
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	});
	await page.waitForTimeout(4_000);
	const atEnd = await page.evaluate(() => ({ ...window.__vitals }));

	const sum = (filter) =>
		requests.filter(filter).reduce((total, request) => total + request.bytes, 0);
	const byBucket = (which) => {
		const out = {};
		for (const request of requests.filter((r) => which.includes(r.phase))) {
			const key = bucket(request.type, request.url);
			out[key] = (out[key] ?? 0) + request.bytes;
		}
		return out;
	};
	await browser.close();
	return {
		label,
		profile: name,
		lcpMs: Math.round(atLoad.lcp),
		clsAtLoad: +atLoad.cls.toFixed(4),
		clsScrolled: +atEnd.cls.toFixed(4),
		longTasksAtLoad: atLoad.longTasks,
		longTaskMsAtLoad: Math.round(atLoad.longTaskMs),
		longTasksScrolled: atEnd.longTasks,
		longTaskMsScrolled: Math.round(atEnd.longTaskMs),
		requestsAtLoad: requests.filter((r) => r.phase === 'load').length,
		bytesAtLoad: sum((r) => r.phase === 'load'),
		bytesScrolled: sum(() => true),
		atLoad: byBucket(['load']),
		total: byBucket(['load', 'scrolled']),
		fonts: requests
			.filter((r) => r.type === 'Font')
			.map((r) => `${r.phase} ${r.bytes} ${r.url.replace(/^https?:\/\/[^/]+/, '')}`),
		consoleIssues: [...new Set(errors)].slice(0, 20)
	};
}

for (const [name, profile] of Object.entries(PROFILES)) {
	if (process.env.PROFILE && process.env.PROFILE !== name) continue;
	console.log(JSON.stringify(await run(name, profile)));
}
