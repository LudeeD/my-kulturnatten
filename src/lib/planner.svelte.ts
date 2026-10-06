import { goto } from '$app/navigation';
import { page } from '$app/state';
import { distance } from './geo.ts';
import { enLabels, strings, type Lang } from './i18n.ts';
import { randomListName } from './names.ts';
import { load, save } from './storage.ts';
import type { KnEvent, Localized, Programme } from './types.ts';

// Before there were several lists, the picks were a plain array under this key.
const OLD_PICKS_KEY = 'kulturnatten2026.picks';
const LISTS_KEY = 'kulturnatten2026.lists';
const MAX_NAME_LENGTH = 40;

export interface PickList {
	id: string;
	name: string;
	/** Event ids. */
	picks: number[];
}
const LANG_KEY = 'kulturnatten2026.lang';
const TRANSIT_KEY = 'kulturnatten2026.transit';
const HINT_KEY = 'kulturnatten2026.hintSeen';

const TOAST_MS = 3000;
// Long enough to read the message and reach for Undo.
const TOAST_WITH_ACTION_MS = 7000;

export interface Toast {
	text: string;
	action?: { label: string; run: () => void };
}

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

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

const sameSet = (a: number[], b: number[]) =>
	a.length === b.length && a.every((x) => b.includes(x));

class Planner {
	events = $state.raw<KnEvent[]>([]);
	fetchedAt = $state('');
	lang = $state<Lang>('da');

	selectedId = $state<number | null>(null);
	selectedFrom = $state<'list' | 'map'>('list');
	/** Bumped to ask the map to fly to the selection. */
	focusTick = $state(0);

	/** Where the user is, once they have asked the map to show it. */
	me = $state.raw<{ lat: number; lng: number } | null>(null);
	/** List is sorted by distance from `me`. */
	nearMe = $state(false);

	toast = $state.raw<Toast | null>(null);
	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	#hintSeen = $state(false);
	/**
	 * Set when a first visit started from someone's link and their list became the visitor's
	 * own, so the first-visit guide can explain what they are looking at.
	 */
	arrival = $state.raw<{ name: string; count: number } | null>(null);

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

	/** My lists. Persisted; the active one is mirrored in the URL hash. Never empty. */
	lists = $state.raw<PickList[]>([{ id: 'default', name: '', picks: [] }]);
	activeId = $state('default');
	/** A list from a link someone sent, shown instead of mine until I decide what to do with it. */
	shared = $state.raw<{ name: string; picks: number[] } | null>(null);

	#byId = new Map<number, KnEvent>();
	#byNo = new Map<number, KnEvent>();
	#searchText = new Map<number, string>();

	active = $derived(this.lists.find((l) => l.id === this.activeId) ?? this.lists[0]);
	/** The picks on screen: the shared list while one is being viewed, otherwise the active list. */
	picks = $derived(new Set(this.shared?.picks ?? this.active.picks));
	selected = $derived(this.selectedId === null ? null : (this.#byId.get(this.selectedId) ?? null));
	filtered = $derived.by(() => {
		const events = this.events.filter(
			(e) => this.matches(e) && (!this.picksOnly || this.picks.has(e.id))
		);
		if (!this.nearMe || !this.me) return events;
		// Events without a position go last.
		return events
			.map((event) => ({ event, metres: this.metresFromMe(event) ?? Infinity }))
			.sort((a, b) => a.metres - b.metres)
			.map((x) => x.event);
	});
	/**
	 * First visit: explain how the app works, until dismissed or the first pick is made.
	 * Not while a shared list is on screen: its banner already says what to do.
	 */
	showHint = $derived(!this.#hintSeen && !this.shared);
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

		this.#hintSeen = load<unknown>(HINT_KEY, false) === true;
		this.#loadLists();
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

	metresFromMe(e: KnEvent): number | null {
		return this.me && placed(e) ? distance(this.me, e) : null;
	}

	dismissHint() {
		this.#hintSeen = true;
		save(HINT_KEY, true);
	}

	notify(text: string, action?: Toast['action']) {
		clearTimeout(this.#toastTimer);
		this.toast = { text, action };
		this.#toastTimer = setTimeout(
			() => (this.toast = null),
			action ? TOAST_WITH_ACTION_MS : TOAST_MS
		);
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
		if (!event) return this.close();
		this.selectedFrom = from;
		this.selectedId = event.id;
		if (from === 'list') this.focusTick++;
		// Opening details adds a history entry, so the browser's back button closes them.
		// Moving on to another event from there does not add more.
		if (!page.state.detail) void goto('', { shallow: true, state: { detail: true } });
	}

	/** Closes the details. The page clears `selectedId` when the history entry goes away. */
	close() {
		if (page.state.detail) history.back();
		else this.selectedId = null;
	}

	listName(list: PickList): string {
		return list.name || this.t.myPicks;
	}

	toggle(id: number) {
		if (this.shared) {
			// Someone else's list is read-only until it is saved; say so rather than do nothing.
			this.notify(this.t.saveToChange, { label: this.t.sharedSave, run: () => this.saveShared() });
			return;
		}
		const picks = this.active.picks;
		const name = this.listName(this.active);
		if (picks.includes(id)) {
			this.#setActivePicks(picks.filter((x) => x !== id));
			this.notify(this.t.removedFrom(name));
		} else {
			this.#setActivePicks([...picks, id]);
			this.notify(this.t.addedTo(name));
			this.dismissHint();
		}
	}

	setActive(id: string) {
		this.#setLists(this.lists, id);
	}

	newList(name: string) {
		const list = { id: crypto.randomUUID(), name: cleanName(name), picks: [] };
		this.#setLists([...this.lists, list], list.id);
	}

	renameActive(name: string) {
		const id = this.active.id;
		this.#setLists(this.lists.map((l) => (l.id === id ? { ...l, name: cleanName(name) } : l)));
	}

	deleteActive() {
		const before = { lists: this.lists, activeId: this.activeId };
		this.notify(this.t.listDeleted(this.listName(this.active)), {
			label: this.t.undo,
			run: () => this.#setLists(before.lists, before.activeId)
		});
		const rest = this.lists.filter((l) => l.id !== this.active.id);
		// There is always one list: deleting the last one leaves a fresh, empty one.
		if (rest.length === 0) {
			this.#setLists([{ id: crypto.randomUUID(), name: randomListName(this.lang), picks: [] }]);
		} else this.#setLists(rest, rest[0].id);
	}

	/**
	 * Shares the list on screen. The page URL always carries it (see `#writeHash`), so sharing
	 * the page is sharing the list; the list's name goes along as the title.
	 */
	async share() {
		const url = location.href;
		const list =
			this.shared?.name || (this.shared ? this.t.sharedList : this.listName(this.active));
		const title = this.picks.size ? `${list} · ${this.t.appTitle}` : this.t.appTitle;
		// The share sheet on phones; on a laptop a copied link is more useful.
		if (navigator.share && matchMedia('(pointer: coarse)').matches) {
			// Rejects when the user closes the share sheet; nothing to do then.
			await navigator.share({ title, url }).catch(() => {});
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			this.notify(this.picks.size ? this.t.listLinkCopied(list) : this.t.linkCopied);
		} catch {
			window.prompt(this.t.copyLink, url);
		}
	}

	/** The list in the URL hash: `#p=201,514&n=Ana` (programme numbers, optional list name). */
	readHash() {
		const numbers = /[#&]p=([\d,]*)/.exec(location.hash)?.[1] ?? '';
		const linked = [
			...new Set(numbers.split(',').flatMap((n) => this.#byNo.get(Number(n))?.id ?? []))
		];
		let name = '';
		try {
			name = cleanName(decodeURIComponent(/[#&]n=([^&]*)/.exec(location.hash)?.[1] ?? ''));
		} catch {
			// A mangled name is not worth refusing the link for.
		}

		// Active list first, so reloading my own link never jumps to an identical other list.
		const existing = [this.active, ...this.lists].find((l) => sameSet(l.picks, linked));
		if (linked.length === 0) {
			this.shared = null;
			this.#writeHash();
		} else if (existing) {
			// A list I already have (my own link, or one I saved earlier): just open it.
			this.#setLists(this.lists, existing.id);
		} else if (this.lists.length === 1 && this.active.picks.length === 0) {
			// Nothing of mine to protect: the linked list simply becomes mine.
			this.#setLists([{ ...this.active, name: name || this.active.name, picks: linked }]);
			this.arrival = { name: this.active.name, count: linked.length };
		} else {
			this.shared = { name, picks: linked };
		}
	}

	/** Keeps the shared list as a new list of its own, next to mine. */
	saveShared() {
		if (!this.shared) return;
		const list = {
			id: crypto.randomUUID(),
			name: this.shared.name || this.t.sharedList,
			picks: this.shared.picks
		};
		this.#setLists([...this.lists, list], list.id);
	}

	mergeShared() {
		if (this.shared)
			this.#setActivePicks([...new Set([...this.active.picks, ...this.shared.picks])]);
	}

	dismissShared() {
		this.shared = null;
		this.#writeHash();
	}

	#loadLists() {
		const known = (ids: unknown) =>
			Array.isArray(ids) ? ids.filter((id) => this.#byId.has(id)) : [];
		const stored = load<{ lists?: unknown; activeId?: unknown } | null>(LISTS_KEY, null);
		const lists = (Array.isArray(stored?.lists) ? (stored.lists as Partial<PickList>[]) : [])
			.filter((l) => l && typeof l.id === 'string')
			.map((l) => ({
				id: l.id!,
				name: cleanName(typeof l.name === 'string' ? l.name : ''),
				picks: known(l.picks)
			}));
		if (lists.length === 0) {
			lists.push({ id: 'default', name: '', picks: known(load<unknown>(OLD_PICKS_KEY, [])) });
		}
		// A first visit, or a list made before names were random: name it now.
		const unnamed = lists.filter((l) => !l.name);
		for (const list of unnamed) list.name = randomListName(this.lang);
		this.lists = lists;
		this.activeId = lists.some((l) => l.id === stored?.activeId)
			? (stored!.activeId as string)
			: lists[0].id;
		// Saved at once, or the name would be different on every visit.
		if (unnamed.length) save(LISTS_KEY, { lists, activeId: this.activeId });
	}

	#setActivePicks(picks: number[]) {
		const id = this.active.id;
		this.#setLists(this.lists.map((l) => (l.id === id ? { ...l, picks } : l)));
	}

	/** Every change to my lists goes through here: it also ends any shared view. */
	#setLists(lists: PickList[], activeId = this.activeId) {
		this.lists = lists;
		this.activeId = activeId;
		this.shared = null;
		save(LISTS_KEY, { lists, activeId });
		this.#writeHash();
	}

	#writeHash() {
		const { name, picks } = this.active;
		// Events without a programme number cannot be put in a link.
		const numbers = picks.flatMap((id) => this.#byId.get(id)?.no || []).sort((a, b) => a - b);
		const hash = numbers.length
			? `#p=${numbers.join(',')}` + (name ? `&n=${encodeURIComponent(name)}` : '')
			: '';
		// Keep page.state: it is what says the details are open.
		void goto(location.pathname + location.search + hash, {
			replace: true,
			shallow: true,
			state: page.state
		});
	}
}

export const planner = new Planner();
