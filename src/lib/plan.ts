// The shared plan is an Automerge document. Every phone on the same link edits its own copy
// and the copies merge: a sync server relays the changes, and IndexedDB keeps the plan
// between visits and while offline.

import {
	initializeWasm,
	isValidAutomergeUrl,
	Repo,
	type AutomergeUrl,
	type DocHandle
} from '@automerge/automerge-repo/slim';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import wasmUrl from '@automerge/automerge/automerge.wasm?url';
import { load, save } from './storage.ts';

// The Automerge project's public sync server. It only relays and stores documents, and
// comes with no uptime guarantee: set VITE_SYNC_URL at build time to use another one.
const SYNC_URL: string = import.meta.env.VITE_SYNC_URL || 'wss://sync.automerge.org';
// A plan that is not on this device is given up on after this long (the link is wrong, or
// there is no connection).
const FIND_TIMEOUT_MS = 15_000;

/** Tiers are just numbers: the group decides what they mean. null is Unsorted. */
export type Tier = number | null;
// There is always one empty tier after the last one in use, so the list grows as it is filled
// and shrinks again by itself. Nothing is stored: the rows follow from where the places are.
export const MIN_TIERS = 2;
export const MAX_TIERS = 9;

/** How much of the pick colour a tier gets: all of it for tier 1, fading to none for the last. */
export const tierStrength = (tier: number, count: number) =>
	Math.max(0, 1 - (tier - 1) / (count - 1)) ** 1.4;
/** From this strength up, the fill is strong enough to need the dark text of a pick. */
export const STRONG = 0.5;

export interface PlanMessage {
	/** Participant id. */
	by: string;
	text: string;
	/** Milliseconds since the epoch. */
	at: number;
	/** Id of the event the message is about, when it is about one. */
	place?: number;
	/** Not something said: the note that `by` joined the plan. `text` is empty. */
	joined?: true;
	/** Not something said either: the note that `by` started sharing their position. */
	position?: true;
}

export interface PlanPlace {
	tier: Tier;
	/** Id of the participant who last put it in its tier. */
	movedBy: string;
}

export interface Participant {
	name: string;
	colour: string;
}

export interface PlanDoc {
	/** Keyed by event id. An event that is not here is not in the plan. */
	places: Record<string, PlanPlace>;
	/** Keyed by participant id. */
	participants: Record<string, Participant>;
	/** What the group calls the plan. */
	name?: string;
	/** What the group calls a tier, by tier number. A tier without a name is just its number. */
	tierNames?: Record<string, string>;
	/** The plan's one chat, oldest first. Missing in plans made before there was one. */
	messages?: PlanMessage[];
}

/** Avatar colours, handed out in this order. All are light enough for dark initials. */
export const COLOURS = [
	'#7dd3fc',
	'#f9a8d4',
	'#86efac',
	'#c4b5fd',
	'#fdba74',
	'#5eead4',
	'#fca5a5',
	'#d9f99d'
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
// The chat shows no more than this many of the latest messages.
const MAX_MESSAGES = 500;

/**
 * A plan as it is safe to show. Anyone with the link can write anything into the document,
 * so nothing in it is taken on trust: what is not a plan gives null, and what is malformed
 * inside one is dropped or cut to size.
 */
export function readPlan(doc: unknown): PlanDoc | null {
	if (!isRecord(doc) || !isRecord(doc.places) || !isRecord(doc.participants)) return null;
	const places: PlanDoc['places'] = {};
	for (const [id, place] of Object.entries(doc.places)) {
		if (!isRecord(place)) continue;
		const tier = Number(place.tier);
		places[id] = {
			tier: Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIERS ? tier : null,
			movedBy: text(place.movedBy, 64)
		};
	}
	const participants: PlanDoc['participants'] = {};
	for (const [id, person] of Object.entries(doc.participants)) {
		if (!isRecord(person)) continue;
		const colour = text(person.colour, 7);
		participants[id] = {
			name: text(person.name, 40),
			colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : COLOURS[0]
		};
	}
	const messages = (Array.isArray(doc.messages) ? doc.messages : [])
		.filter(isRecord)
		.slice(-MAX_MESSAGES)
		.map((m): PlanMessage => ({
			by: text(m.by, 64),
			text: text(m.text, 300),
			at: Number.isFinite(m.at) ? (m.at as number) : 0,
			...(Number.isInteger(m.place) ? { place: m.place as number } : {}),
			...(m.joined === true ? { joined: true } : {}),
			...(m.position === true ? { position: true } : {})
		}));
	const tierNames: Record<string, string> = {};
	for (const [tier, name] of Object.entries(isRecord(doc.tierNames) ? doc.tierNames : {})) {
		if (text(name, 24)) tierNames[tier] = text(name, 24);
	}
	return { places, participants, messages, tierNames, name: text(doc.name, 40) || undefined };
}

export const newPlace = (by: string): PlanPlace => ({ tier: null, movedBy: by });

// A plan stays on this device until it is shared. Only the plans listed here (the ones I have
// shared, and the ones opened from someone's link) are ever sent to the sync server or asked
// of it, and the server is not even connected to before there is one.
const SHARED_KEY = 'kulturnatten2026.shared';
const stored = load<unknown>(SHARED_KEY, []);
const shared = new Set<string>(
	Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []
);
const allowed = async (_peer: unknown, id?: string) => id !== undefined && shared.has(id);

let connected = false;
function connect(to: Repo) {
	if (connected || shared.size === 0) return;
	connected = true;
	to.networkSubsystem.addNetworkAdapter(new WebSocketClientAdapter(SYNC_URL));
}

let repo: Promise<Repo> | undefined;
const getRepo = () =>
	(repo ??= initializeWasm(wasmUrl).then(() => {
		const created = new Repo({
			storage: new IndexedDBStorageAdapter('kulturnatten2026'),
			shareConfig: { announce: allowed, access: allowed }
		});
		connect(created);
		return created;
	}));

export const isShared = (id: string) => shared.has(id);

/** Puts a plan online, for good: what the sync server has been sent cannot be taken back. */
export async function sharePlan(id: string) {
	shared.add(id);
	save(SHARED_KEY, [...shared]);
	const to = await getRepo();
	connect(to);
	to.shareConfigChanged();
}

const toUrl = (id: string) => `automerge:${id}` as AutomergeUrl;

/** Whether this is the kind of id a plan link carries. */
export const validPlanId = (id: unknown): id is string =>
	typeof id === 'string' && isValidAutomergeUrl(toUrl(id));

export async function createPlan(initial: PlanDoc): Promise<DocHandle<PlanDoc>> {
	return (await getRepo()).create<PlanDoc>(initial);
}

/**
 * Rejects when the plan cannot be found. A plan from someone's link (`remote`) is shared by
 * definition and is asked of the sync server; any other is only looked for on this device.
 */
export async function findPlan(id: string, remote = false): Promise<DocHandle<PlanDoc>> {
	if (remote) await sharePlan(id);

	return (await getRepo()).find<PlanDoc>(toUrl(id), {
		signal: AbortSignal.timeout(FIND_TIMEOUT_MS)
	});
}

const SHORT_NAME_LENGTH = 24;

/**
 * A name short enough for a chip or a map pin, from the organiser's name: what comes before
 * the first dash, comma or slash, cut at a word when that is still too long.
 */
export function shortName(organizer: string): string {
	const head = organizer.split(/\s[-–/|]\s|,\s|\s\(/)[0].trim() || organizer;
	if (head.length <= SHORT_NAME_LENGTH) return head;
	const cut = head.slice(0, SHORT_NAME_LENGTH);
	return cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).trimEnd() + '…';
}
