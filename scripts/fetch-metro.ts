// Downloads the Copenhagen metro lines and stations from OpenStreetMap and writes static/data/metro.json.
// Run with `npm run fetch:metro`. The lines rarely change, so this is run by hand, not on a
// schedule. The map tiles only contain metro tracks from zoom 14, which is why we ship our own.
//
// Data © OpenStreetMap contributors (ODbL); the map's attribution already credits them.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../static/data/metro.json');
const USER_AGENT = 'my-kulturnatten-planner/0.1 (personal non-commercial planner; one-off query)';

// Greater Copenhagen: south, west, north, east.
const QUERY = `[out:json][timeout:60];
relation["type"="route"]["route"="subway"](55.55,12.3,55.82,12.72)->.routes;
.routes out geom;
node(r.routes);
out;`;

const EXPECTED_LINES = ['M1', 'M2', 'M3', 'M4'];
// The network has 44 stations; far fewer means the stops were not tagged the way we expect.
const MIN_STATIONS = 35;

interface Relation {
	type: 'relation';
	id: number;
	tags: { ref?: string; colour?: string; name?: string };
	members: {
		type: string;
		ref: number;
		role: string;
		geometry?: { lat: number; lon: number }[];
	}[];
}

interface Node {
	type: 'node';
	id: number;
	lat: number;
	lon: number;
	tags?: { name?: string };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

const res = await fetch(OVERPASS_URL, {
	method: 'POST',
	headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
	body: `data=${encodeURIComponent(QUERY)}`,
	signal: AbortSignal.timeout(90_000)
});
if (!res.ok) {
	console.error(`FETCH FAILED: HTTP ${res.status} from Overpass. ${OUT_FILE} was left untouched.`);
	process.exit(1);
}
const elements = ((await res.json()) as { elements: (Relation | Node)[] }).elements;
const relations = elements.filter((e) => e.type === 'relation');
const nodes = new Map(elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));

// Each line has one relation per direction, on parallel tracks. One direction is enough to draw.
const lines = new Map<string, Relation>();
for (const r of relations.sort((a, b) => a.id - b.id)) {
	if (r.tags.ref && !lines.has(r.tags.ref)) lines.set(r.tags.ref, r);
}

const missing = EXPECTED_LINES.filter((ref) => !lines.has(ref));
if (missing.length) {
	console.error(
		`FETCH FAILED: no route found for ${missing.join(', ')}. ${OUT_FILE} was left untouched.`
	);
	process.exit(1);
}

const colour = (ref: string) => lines.get(ref)?.tags.colour ?? '#ff6b81';

const lineFeatures = [...lines.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([ref, r]) => ({
		type: 'Feature',
		properties: { kind: 'line', ref, colour: colour(ref) },
		geometry: {
			type: 'MultiLineString',
			coordinates: r.members
				// Stations and platforms are members too; tracks have an empty role.
				.filter((m) => m.type === 'way' && m.role === '' && m.geometry)
				.map((m) => m.geometry!.map((p) => [round(p.lon), round(p.lat)]))
		}
	}));

// Stations: the stop members of every route (both directions), grouped by name.
const stations = new Map<string, { refs: Set<string>; lats: number[]; lons: number[] }>();
for (const r of relations) {
	if (!r.tags.ref || !lines.has(r.tags.ref)) continue;
	for (const m of r.members) {
		const node = m.type === 'node' && m.role.startsWith('stop') ? nodes.get(m.ref) : undefined;
		const name = node?.tags?.name;
		if (!node || !name) continue;
		const station = stations.get(name) ?? { refs: new Set(), lats: [], lons: [] };
		station.refs.add(r.tags.ref);
		station.lats.push(node.lat);
		station.lons.push(node.lon);
		stations.set(name, station);
	}
}
if (stations.size < MIN_STATIONS) {
	console.error(
		`FETCH FAILED: only ${stations.size} stations found. ${OUT_FILE} was left untouched.`
	);
	process.exit(1);
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

// One point per station and line. `ring` numbers a station's lines from 0, so the map can
// draw an interchange as concentric rings, one in each line's colour.
const stationFeatures = [...stations.entries()].flatMap(([name, s]) =>
	[...s.refs].sort().map((ref, ring) => ({
		type: 'Feature',
		properties: { kind: 'station', name, ref, colour: colour(ref), ring },
		geometry: { type: 'Point', coordinates: [round(mean(s.lons)), round(mean(s.lats))] }
	}))
);

mkdirSync(dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify({
	type: 'FeatureCollection',
	features: [...lineFeatures, ...stationFeatures]
});
writeFileSync(`${OUT_FILE}.tmp`, json);
renameSync(`${OUT_FILE}.tmp`, OUT_FILE);

for (const f of lineFeatures) {
	const points = f.geometry.coordinates.reduce((n, way) => n + way.length, 0);
	console.log(
		`${f.properties.ref}  ${f.properties.colour}  ${f.geometry.coordinates.length} ways, ${points} points`
	);
}
console.log(`${stations.size} stations`);
for (const [name, s] of stations) {
	if (s.refs.size > 2) console.log(`  ${name}: ${[...s.refs].sort().join(', ')}`);
}
console.log(`Wrote ${OUT_FILE} (${(json.length / 1024).toFixed(0)} kB)`);
