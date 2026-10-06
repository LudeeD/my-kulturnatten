import { replaceState } from '$app/navigation';
import { distance } from './geo.ts';
import { enLabels, strings, type Lang } from './i18n.ts';
import { load, save } from './storage.ts';
import type { KnEvent, Localized, Programme } from './types.ts';

const PICKS_KEY = 'kulturnatten2026.picks';
const LANG_KEY = 'kulturnatten2026.lang';
const TRANSIT_KEY = 'kulturnatten2026.transit';

export const TRANSIT_KINDS = [
	'metroLines',
	'metroStations',
	'trainLines',
	'trainStations'
] as const;
export type TransitKind = (typeof TRANSIT_KINDS)[number];

// How many non-picked neighbours to suggest under an open event.
const NEARBY_COUNT = 5;

export type Placed = KnEvent & { lat: number; lng: number };
/** Has usable coordinates, so it can be shown on the map and measured from. */
export const placed = (e: KnEvent): e is Placed => e.lat !== null && e.lng !== null && !e.badCoords;

const sameSet = (a: number[], b: number[]) =>
	a.length === b.length && a.every((x) => b.includes(x));

class Planner {
	events = $state.raw<KnEvent[]>([]);
	fetchedAt = $state('');
	lang = $state<Lang>('da');

	selectedId = $state<number | null>(null);
	selectedFrom = $state<'list' | 'map'>('list');
	/** Bumped to ask the map to fly to the selection / the list to scroll to it. */
	focusTick = $state(0);
	scrollTick = $state(0);

	query = $state('');
	area = $state('');
	type = $state('');
	childOnly = $state(false);
	/** List shows only picks. */
	picksOnly = $state(false);
	/** Map hides everything that is not a pick. */
	hideOthers = $state(false);
	/** Which metro and train layers the map highlights. Stations only, unless the user asks for more. */
	transit = $state<Record<TransitKind, boolean>>({
		metroLines: false,
		metroStations: true,
		trainLines: false,
		trainStations: true
	});
	/** Phone only: how far the list is pulled up over the map. */
	sheet = $state<'peek' | 'half' | 'full'>('half');

	/** My picks, as event ids. Persisted and mirrored in the URL hash. */
	mine = $state.raw<number[]>([]);
	/** Picks from a link someone sent, shown instead of mine until I decide what to do with them. */
	shared = $state.raw<number[] | null>(null);

	#byId = new Map<number, KnEvent>();
	#byNo = new Map<number, KnEvent>();
	#searchText = new Map<number, string>();

	picks = $derived(new Set(this.shared ?? this.mine));
	selected = $derived(this.selectedId === null ? null : (this.#byId.get(this.selectedId) ?? null));
	filtered = $derived(
		this.events.filter((e) => this.matches(e) && (!this.picksOnly || this.picks.has(e.id)))
	);
	activeFilters = $derived((this.area ? 1 : 0) + (this.type ? 1 : 0) + (this.childOnly ? 1 : 0));

	get t() {
		return strings[this.lang];
	}

	/** Text in the current language, falling back to Danish where English is missing. */
	tr(text: Localized): string {
		return text[this.lang] || text.da;
	}

	label(danish: string): string {
		return this.lang === 'en' ? (enLabels[danish] ?? danish) : danish;
	}

	init(programme: Programme) {
		// Unnumbered events go last.
		const events = [...programme.events].sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
		for (const e of events) {
			this.#byId.set(e.id, e);
			if (e.no) this.#byNo.set(e.no, e);
			this.#searchText.set(
				e.id,
				[e.no, e.title.da, e.title.en, e.organizer.da, e.organizer.en, e.address, e.area]
					.concat(e.description.da, e.description.en)
					.concat(e.subEvents.flatMap((s) => [s.title.da, s.title.en]))
					.join('\n')
					.toLowerCase()
			);
		}
		this.events = events;
		this.fetchedAt = programme.fetchedAt;

		const storedLang = load<string | null>(LANG_KEY, null);
		this.lang =
			storedLang === 'da' || storedLang === 'en'
				? storedLang
				: navigator.language.toLowerCase().startsWith('da')
					? 'da'
					: 'en';

		const transit = load<Partial<Record<TransitKind, unknown>> | null>(TRANSIT_KEY, null);
		for (const kind of TRANSIT_KINDS) {
			if (typeof transit?.[kind] === 'boolean') this.transit[kind] = transit[kind];
		}

		const stored = load<unknown>(PICKS_KEY, []);
		this.mine = Array.isArray(stored) ? stored.filter((id) => this.#byId.has(id)) : [];
		this.readHash();
	}

	setLang(lang: Lang) {
		this.lang = lang;
		save(LANG_KEY, lang);
	}

	/** Search and filters, without the "my picks" restriction. */
	matches(e: KnEvent): boolean {
		const q = this.query.trim().toLowerCase();
		return (
			(!this.area || e.area === this.area) &&
			(!this.type || e.types.includes(this.type)) &&
			(!this.childOnly || e.childFriendly) &&
			(!q || this.#searchText.get(e.id)!.includes(q))
		);
	}

	setTransit(kind: TransitKind, on: boolean) {
		this.transit[kind] = on;
		save(TRANSIT_KEY, this.transit);
	}

	/** Where to go next from an event: the other picks, and the closest other events. */
	onward(from: Placed) {
		const all = this.events
			.filter((e) => e.id !== from.id)
			.filter(placed)
			.map((event) => ({ event, metres: distance(from, event) }))
			.sort((a, b) => a.metres - b.metres);
		return {
			picks: all.filter((x) => this.picks.has(x.event.id)),
			nearby: all.filter((x) => !this.picks.has(x.event.id)).slice(0, NEARBY_COUNT)
		};
	}

	clearFilters() {
		this.query = '';
		this.area = '';
		this.type = '';
		this.childOnly = false;
	}

	select(id: number | null, from: 'list' | 'map' = 'list') {
		const event = id === null ? undefined : this.#byId.get(id);
		// A marker can be tapped while the list is filtered down to something else.
		if (event && from === 'map' && !this.filtered.includes(event)) {
			this.clearFilters();
			if (!this.picks.has(event.id)) this.picksOnly = false;
		}
		this.selectedFrom = from;
		this.selectedId = event ? event.id : null;
		if (event && from === 'list') this.focusTick++;
	}

	toggle(id: number) {
		if (this.shared) return;
		this.#setMine(this.mine.includes(id) ? this.mine.filter((x) => x !== id) : [...this.mine, id]);
	}

	/** Picks in the URL hash: `#p=201,514` (programme numbers). */
	readHash() {
		const m = /[#&]p=([\d,]*)/.exec(location.hash);
		const linked = m
			? [...new Set(m[1].split(',').flatMap((n) => this.#byNo.get(Number(n))?.id ?? []))]
			: [];
		if (linked.length === 0 || sameSet(linked, this.mine)) {
			this.shared = null;
			this.#writeHash();
		} else if (this.mine.length === 0) {
			// Nothing of mine to protect: the linked plan simply becomes mine.
			this.#setMine(linked);
		} else {
			this.shared = linked;
		}
	}

	replaceWithShared() {
		if (this.shared) this.#setMine(this.shared);
	}

	mergeShared() {
		if (this.shared) this.#setMine([...new Set([...this.mine, ...this.shared])]);
	}

	dismissShared() {
		this.shared = null;
		this.#writeHash();
	}

	#setMine(ids: number[]) {
		this.mine = ids;
		this.shared = null;
		save(PICKS_KEY, ids);
		this.#writeHash();
	}

	#writeHash() {
		// Events without a programme number cannot be put in a link.
		const numbers = this.mine.flatMap((id) => this.#byId.get(id)?.no || []).sort((a, b) => a - b);
		const url =
			location.pathname + location.search + (numbers.length ? `#p=${numbers.join(',')}` : '');
		replaceState(url, {});
	}
}

export const planner = new Planner();
