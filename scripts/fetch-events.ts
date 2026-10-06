// Downloads the full Kulturnatten programme and writes static/data/events.json.
// Run with `npm run fetch` (plain Node >= 22.18, no build step).
//
// Exits non-zero without touching the existing file when the result looks broken.
// Pass --force to accept a result that is much smaller than the previous one.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnEvent, Minutes, Programme, SubEvent, TimeSlot } from '../src/lib/types.ts';

const EVENTS_URL = 'https://kulturnatten.dk/wp-json/kulturnatten/v1/events';
const PROGRAMME_URL = 'https://kulturnatten.dk/programmet/';
const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../static/data/events.json');

const USER_AGENT =
	'my-kulturnatten-planner/0.1 (personal non-commercial planner; fetches a static snapshot a few times a day)';
const REQUEST_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;

// The 2026 programme has 220 events. Anything far below that is a broken fetch.
const MIN_EVENTS = 150;
// Refuse to replace an existing file with one that has lost more than this share of events.
const MIN_SHARE_OF_PREVIOUS = 0.8;

const EVENING_START = 18 * 60;
const SIGNUP_LABEL = 'Tilmelding påkrævet';

// Greater Copenhagen, generously: Køge Bugt to Lyngby, Ballerup to Amager's east coast.
const BOUNDS = { minLat: 55.55, maxLat: 55.82, minLng: 12.3, maxLng: 12.72 };

interface RawSub {
	title?: string;
	title_english?: string;
	start_time?: string;
	end_time?: string;
	time_table?: { start_time?: string; end_time?: string }[];
	sub_description?: string;
	sub_description_english?: string;
	signup_url?: string;
	handicap_friendly?: boolean;
	children_friendly?: boolean;
}

interface RawEvent {
	id: number;
	title?: string;
	en_title?: string;
	description?: string;
	en_description?: string;
	organizer_name?: string;
	organizer_name_en?: string;
	area?: string;
	area_number?: string;
	event_address?: string;
	zip_code?: string;
	city?: string;
	// `false` when the organiser never placed the pin.
	coordinates?: { lat?: number | string; lng?: number | string } | false | null;
	event_start_time?: string | null;
	end_time?: string | null;
	event_types?: string[];
	target_group?: string[];
	children_friendly?: boolean;
	practical?: string[];
	register_url?: string | null;
	website?: string | null;
	itinerary_url?: string | null;
	cover_image?: string | null;
	has_amendments?: boolean;
	amendment?: string | null;
	sub_arrangements?: RawSub[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(message: string): never {
	console.error(`\nFETCH FAILED: ${message}`);
	console.error(`${OUT_FILE} was left untouched.`);
	process.exit(1);
}

async function get(url: string, accept: string): Promise<Response> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		if (attempt > 1) await sleep(REQUEST_DELAY_MS * attempt);
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': USER_AGENT, Accept: accept },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (res.ok) return res;
			lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
			// Client errors won't fix themselves; only retry server errors and rate limits.
			if (res.status < 500 && res.status !== 429) break;
		} catch (err) {
			lastError = err;
		}
		console.warn(`  attempt ${attempt}/${ATTEMPTS} for ${url} failed: ${lastError}`);
	}
	throw new Error(`${url}: ${lastError}`);
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
		if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? match;
		const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
		return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
	});
}

/** Single-line plain text. */
function clean(value: unknown): string {
	if (typeof value !== 'string') return '';
	return decodeEntities(value.replace(/<\/?[a-z][^>]*>/gi, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

/** Multi-line plain text: some descriptions are pasted HTML, so tags become line breaks/bullets. */
function cleanText(value: unknown): string {
	if (typeof value !== 'string') return '';
	const text = value
		.replace(/\r\n?/g, '\n')
		.replace(/<li[^>]*>/gi, '\n• ')
		.replace(/<br\s*\/?>|<\/(p|div|li|ul|ol)>/gi, '\n')
		.replace(/<\/?[a-z][^>]*>/gi, '');
	return decodeEntities(text)
		.replace(/[ \t\u00a0]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function cleanList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(clean).filter(Boolean))];
}

function cleanUrl(value: unknown): string | null {
	// Not clean(): a URL may legitimately contain spaces (the Rejseplanen links do).
	if (typeof value !== 'string') return null;
	const url = decodeEntities(value).trim();
	if (!url) return null;
	// A few organisers typed a bare domain ("example.dk").
	return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** "HH:MM" to minutes after 18:00, so that 00:00 (and 01:00) sort after 23:00. */
function toMinutes(value: unknown): Minutes | null {
	if (typeof value !== 'string') return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return (h * 60 + min - EVENING_START + 24 * 60) % (24 * 60);
}

function normaliseSub(raw: RawSub): SubEvent {
	const start = toMinutes(raw.start_time) ?? 0;
	const end = toMinutes(raw.end_time);
	const slots: TimeSlot[] = [];
	for (const row of raw.time_table ?? []) {
		const s = toMinutes(row.start_time);
		const e = toMinutes(row.end_time);
		if (s !== null && e !== null) slots.push({ start: s, end: e });
	}
	slots.sort((a, b) => a.start - b.start);
	return {
		title: { da: clean(raw.title), en: clean(raw.title_english) },
		description: {
			da: cleanText(raw.sub_description),
			en: cleanText(raw.sub_description_english)
		},
		start,
		// "18:00–18:00" is how an unfilled end time shows up in the source.
		end: end !== null && end > start ? end : null,
		slots,
		signupUrl: cleanUrl(raw.signup_url),
		childFriendly: raw.children_friendly === true,
		accessible: raw.handicap_friendly === true
	};
}

function normalise(raw: RawEvent, warnings: string[]): KnEvent {
	const no = Number.parseInt(raw.area_number ?? '', 10);
	const label = `#${raw.area_number || '?'} (id ${raw.id}) "${clean(raw.title)}"`;
	if (!Number.isFinite(no)) warnings.push(`${label}: no programme number`);

	const coords = raw.coordinates || null;
	const lat = coords ? Number(coords.lat) : NaN;
	const lng = coords ? Number(coords.lng) : NaN;
	const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
	const inBounds =
		hasCoords &&
		lat >= BOUNDS.minLat &&
		lat <= BOUNDS.maxLat &&
		lng >= BOUNDS.minLng &&
		lng <= BOUNDS.maxLng;

	const end = toMinutes(raw.end_time);
	if (end === null) warnings.push(`${label}: unreadable end_time ${JSON.stringify(raw.end_time)}`);

	const practical = cleanList(raw.practical);
	const signupUrl = cleanUrl(raw.register_url);

	return {
		id: raw.id,
		no: Number.isFinite(no) ? no : 0,
		area: clean(raw.area),
		organizer: { da: clean(raw.organizer_name), en: clean(raw.organizer_name_en) },
		title: { da: clean(raw.title), en: clean(raw.en_title) },
		description: { da: cleanText(raw.description), en: cleanText(raw.en_description) },
		address: clean(raw.event_address),
		zip: clean(raw.zip_code),
		city: clean(raw.city),
		lat: hasCoords ? lat : null,
		lng: hasCoords ? lng : null,
		badCoords: !inBounds,
		// A null start means "from the 18:00 opening".
		start: toMinutes(raw.event_start_time) ?? 0,
		end: end ?? 6 * 60,
		types: cleanList(raw.event_types),
		audience: cleanList(raw.target_group),
		practical: practical.filter((p) => p !== SIGNUP_LABEL),
		childFriendly: raw.children_friendly === true,
		signupRequired: practical.includes(SIGNUP_LABEL) || signupUrl !== null,
		signupUrl,
		website: cleanUrl(raw.website),
		itineraryUrl: cleanUrl(raw.itinerary_url),
		image: cleanUrl(raw.cover_image),
		amendment: cleanText(raw.amendment) || null,
		subEvents: (raw.sub_arrangements ?? []).map(normaliseSub)
	};
}

/**
 * The route returns every event twice: the Danish post and its English-site twin, with
 * different ids but identical content (both carry the da and en fields). Keep one per
 * programme number: the lowest id, which is the one the Danish programme page links to.
 * A handful of events exist only once, so this cannot be a blind "take every other record".
 */
function dedupe(raw: RawEvent[], warnings: string[]): { events: RawEvent[]; twins: number } {
	const byId = new Map<number, RawEvent>();
	for (const e of raw) byId.set(e.id, e);

	const byNumber = new Map<string, RawEvent>();
	let twins = 0;
	for (const e of [...byId.values()].sort((a, b) => a.id - b.id)) {
		// An event that has not been given a number yet still has a twin; match those on content.
		const key = e.area_number?.trim() || `${e.title}|${e.event_address}`;
		const kept = byNumber.get(key);
		if (!kept) {
			byNumber.set(key, e);
			continue;
		}
		twins++;
		if (JSON.stringify({ ...kept, id: 0 }) !== JSON.stringify({ ...e, id: 0 })) {
			warnings.push(
				`#${key}: ids ${kept.id} and ${e.id} share a programme number but differ in content; kept ${kept.id}`
			);
		}
	}
	return { events: [...byNumber.values()], twins };
}

/** The programme page embeds its own total; used only as a cross-check. */
async function officialCount(): Promise<number | null> {
	try {
		const html = await (await get(PROGRAMME_URL, 'text/html')).text();
		const m = /"total_rows":(\d+)/.exec(html);
		return m ? Number(m[1]) : null;
	} catch (err) {
		console.warn(`  could not read the programme page: ${err}`);
		return null;
	}
}

function previousCount(): number | null {
	if (!existsSync(OUT_FILE)) return null;
	try {
		const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Programme;
		return Array.isArray(prev.events) ? prev.events.length : null;
	} catch {
		return null;
	}
}

const time = (m: Minutes) =>
	`${String(Math.floor((m + EVENING_START) / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function printSummary(events: KnEvent[], warnings: string[]) {
	const perArea = new Map<string, number>();
	for (const e of events) perArea.set(e.area, (perArea.get(e.area) ?? 0) + 1);

	const withSubs = events.filter((e) => e.subEvents.length > 0);
	const withTimedSubs = events.filter((e) =>
		e.subEvents.some((s) => s.slots.length > 0 || s.start > 0)
	);
	const signup = events.filter((e) => e.signupRequired);
	const subSignup = events.filter((e) => e.subEvents.some((s) => s.signupUrl));
	const amended = events.filter((e) => e.amendment);
	const bad = events.filter((e) => e.badCoords);

	console.log(`\nEvents: ${events.length}`);
	console.log('\nPer area:');
	for (const [area, n] of [...perArea].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(n).padStart(4)}  ${area}`);
	}
	console.log(`\nWith sub-events:              ${withSubs.length}`);
	console.log(
		`  with timed sub-events:      ${withTimedSubs.length}  (fixed slots or a start after 18:00)`
	);
	console.log(
		`Sign-up required:             ${signup.length}  (${signup.filter((e) => e.signupUrl).length} with a link)`
	);
	console.log(
		`  sign-up on a sub-event only: ${subSignup.filter((e) => !e.signupRequired).length}`
	);
	console.log(`Child-friendly:               ${events.filter((e) => e.childFriendly).length}`);
	console.log(`Closing after midnight:       ${events.filter((e) => e.end > 360).length}`);
	console.log(`With amendments:              ${amended.length}`);
	for (const e of amended) console.log(`  #${e.no} ${e.title.da}: ${e.amendment}`);

	console.log(`\nMissing or out-of-area coordinates: ${bad.length}`);
	for (const e of bad) {
		const where = e.lat === null ? 'none' : `${e.lat}, ${e.lng}`;
		console.log(`  #${e.no} (id ${e.id}) ${e.title.da}`);
		console.log(`      ${e.address}, ${e.zip} ${e.city}  [coordinates: ${where}]`);
	}

	if (warnings.length) {
		console.log(`\nWarnings: ${warnings.length}`);
		for (const w of warnings) console.log(`  ${w}`);
	}
}

async function main() {
	const force = process.argv.includes('--force');
	const warnings: string[] = [];

	console.log(`GET ${EVENTS_URL}`);
	const res = await get(EVENTS_URL, 'application/json');
	const body = await res.text();
	console.log(`  ${res.status}, ${(body.length / 1024).toFixed(0)} kB`);

	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		fail(`response is not valid JSON (truncated?). It starts with: ${body.slice(0, 120)}`);
	}
	if (!Array.isArray(raw)) fail('response is not a JSON array');
	const rawEvents = (raw as RawEvent[]).filter((e) => e && typeof e.id === 'number');
	if (rawEvents.length === 0) fail('response contains no events');

	const { events: unique, twins } = dedupe(rawEvents, warnings);
	console.log(
		`  ${rawEvents.length} records, ${twins} translation twins dropped, ${unique.length} unique`
	);

	const events = unique.map((e) => normalise(e, warnings)).sort((a, b) => a.no - b.no);

	if (events.length < MIN_EVENTS) {
		fail(`only ${events.length} events (expected at least ${MIN_EVENTS})`);
	}
	const previous = previousCount();
	if (previous !== null && events.length < previous * MIN_SHARE_OF_PREVIOUS && !force) {
		fail(
			`${events.length} events, down from ${previous} in the existing file. Re-run with --force if that is real.`
		);
	}

	await sleep(REQUEST_DELAY_MS);
	console.log(`GET ${PROGRAMME_URL}`);
	const official = await officialCount();
	if (official === null) {
		console.log('  could not find the official total; skipping the cross-check');
	} else if (official === events.length) {
		console.log(`  official programme lists ${official} events: matches`);
	} else {
		warnings.push(`official programme page lists ${official} events, we have ${events.length}`);
	}

	const programme: Programme = {
		fetchedAt: new Date().toISOString(),
		source: EVENTS_URL,
		count: events.length,
		events: []
	};
	// One event per line: small enough to ship as is, and still diffable.
	const json =
		JSON.stringify(programme).replace(/\[\]\}$/, '[\n') +
		events.map((e) => JSON.stringify(e)).join(',\n') +
		'\n]}\n';

	mkdirSync(dirname(OUT_FILE), { recursive: true });
	const tmp = `${OUT_FILE}.tmp`;
	writeFileSync(tmp, json);
	renameSync(tmp, OUT_FILE);

	printSummary(events, warnings);
	console.log(`\nWrote ${OUT_FILE} (${(Buffer.byteLength(json) / 1024).toFixed(0)} kB)`);
	console.log(`Last closing time: ${time(Math.max(...events.map((e) => e.end)))}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
