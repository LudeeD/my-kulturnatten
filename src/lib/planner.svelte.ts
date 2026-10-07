import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { DocHandle } from '@automerge/automerge-repo/slim';
import { distance } from './geo.ts';
import { enLabels, strings, type Lang } from './i18n.ts';
import {
	COLOURS,
	createPlan,
	findPlan,
	isShared,
	MAX_TIERS,
	MIN_TIERS,
	newPlace,
	readPlan,
	sharePlan,
	validPlanId,
	type PlanDoc,
	type Tier
} from './plan.ts';
import { load, save } from './storage.ts';
import type { KnEvent, Localized, Programme } from './types.ts';

// Before the shared plan, the picks lived in named lists, and before that in a
// plain array. Both are only read, once, to start the first plan from them.
const OLD_PICKS_KEY = 'kulturnatten2026.picks';
const OLD_LISTS_KEY = 'kulturnatten2026.lists';
/** Id of the plan last opened here. */
const PLAN_KEY = 'kulturnatten2026.plan';
const ME_KEY = 'kulturnatten2026.me';
/** The plans opened on this device, so that leaving one is not losing it. */
const PLANS_KEY = 'kulturnatten2026.plans';
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 300;
const MAX_TIER_NAME_LENGTH = 24;
/** Per plan id: how many of its chat messages have been seen here. */
const READ_KEY = 'kulturnatten2026.read';
const LANG_KEY = 'kulturnatten2026.lang';
const TRANSIT_KEY = 'kulturnatten2026.transit';

/** A plan this device knows, as the menu lists it. The name is as it was when last open here. */
export interface KnownPlan {
	id: string;
	name: string;
	shared: boolean;
}

/** A place in the plan, joined with its event from the programme. */
export interface Place {
	event: KnEvent;
	tier: Tier;
	movedBy: string;
}

// Presence: everyone with a shared plan open says so this often. It is never stored; whoever
// has not been heard from for a while counts as away.
const HERE_EVERY_MS = 15_000;
const AWAY_AFTER_MS = 40_000;
// Positions travel the same way, and so are never stored either. Sharing ends by itself.
const SHARE_POSITION_MS = 15 * 60_000;
// Sent when I have moved this far, and otherwise with every round of presence.
const POSITION_STEP_METRES = 20;
// A phone in a pocket stops sending. Its last position is shown for this long, with its age.
const POSITION_KEPT_MS = 5 * 60_000;

/** Where someone else in the plan is, while they share it. */
export interface Friend {
	id: string;
	lat: number;
	lng: number;
	/** Whole minutes since it was last heard. */
	minutes: number;
}

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

const clean = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

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

	query = $state('');
	area = $state('');
	type = $state('');
	childOnly = $state(false);
	/** The plan, or the whole programme to add places from. */
	view = $state<'plan' | 'all'>('plan');
	/** Map hides everything that is not a pick. */
	hideOthers = $state(false);
	/** Which metro and train layers the map highlights. Stations only, unless the user asks for more. */
	transit = $state<Record<TransitKind, boolean>>({
		metroLines: false,
		metroStations: true,
		trainLines: false,
		trainStations: true
	});
	/** Phone only: the map fills the screen instead of sitting small above the plan. */
	bigMap = $state(false);

	/** Who I am to the others in a plan. The name is asked for when it is first needed. */
	user = $state.raw({ id: '', name: '' });
	/** The question for my name is showing. */
	naming = $state(false);
	/** It is asked because I opened someone's link: it then also says how a shared plan works. */
	joining = $state(false);
	plans = $state.raw<KnownPlan[]>([]);
	planId = $state<string | null>(null);
	#afterName: (() => void) | undefined;

	/** The plan as last seen. Null until a link is opened or the first place is added. */
	plan = $state.raw<PlanDoc | null>(null);
	planState = $state<'ready' | 'loading' | 'missing'>('ready');
	/** The plan is online, for anyone with its link. Until then it is only on this device. */
	shared = $state(false);
	/** The question before sharing is showing. */
	sharing = $state(false);
	#planId: string | null = null;
	#handle: DocHandle<PlanDoc> | undefined;
	/** The plan's chat is open. Only a shared plan has one. */
	chatOpen = $state(false);
	/** The place the message being written is about, if any. */
	chatAbout = $state<number | null>(null);
	/** How many chat messages have been seen on this device. */
	#read = $state(0);
	/** When each participant was last heard from, by id. */
	#heard = $state.raw<Record<string, number>>({});
	/** Moves on with every round of presence, so that silence turns into "away". */
	#clock = $state(Date.now());
	#presence: ReturnType<typeof setInterval> | undefined;
	#positions = $state.raw<Record<string, { lat: number; lng: number; at: number }>>({});
	/** I am sharing my position with the plan. Ends by itself after a quarter of an hour. */
	sharingPosition = $state(false);
	#shareTimer: ReturnType<typeof setTimeout> | undefined;
	#sent: { lat: number; lng: number } | null = null;
	#watch: number | undefined;
	/** The place whose panel is open in the plan. */
	openPlaceId = $state<number | null>(null);

	#byId = new Map<number, KnEvent>();
	#byNo = new Map<number, KnEvent>();
	#searchText = new Map<number, string>();

	/** In programme order: there is no order inside a tier, but the chips should not jump about. */
	places = $derived.by(() =>
		Object.entries(this.plan?.places ?? {})
			.flatMap(([id, place]): Place[] => {
				const event = this.#byId.get(Number(id));
				// An event can leave the programme after it was planned.
				if (!event) return [];
				return [{ event, tier: place.tier, movedBy: place.movedBy }];
			})
			.sort((a, b) => (a.event.no || Infinity) - (b.event.no || Infinity))
	);
	/** How many tiers are in use: up to the lowest one with a place in it, and never under two. */
	usedTiers = $derived(Math.max(MIN_TIERS, ...this.places.map((p) => p.tier ?? 0)));
	/** The tiers on screen: those in use, and one empty tier after them to grow into. */
	tierCount = $derived(
		this.places.some((p) => p.tier === this.usedTiers)
			? Math.max(this.usedTiers, Math.min(MAX_TIERS, this.usedTiers + 1))
			: this.usedTiers
	);
	/** The rows of the plan, top to bottom: the numbered tiers, then Unsorted. */
	tiers = $derived<Tier[]>([...Array.from({ length: this.tierCount }, (_, i) => i + 1), null]);
	/** Ids of the events in the plan. */
	picks = $derived(new Set(this.places.map((p) => p.event.id)));
	openPlace = $derived(this.places.find((p) => p.event.id === this.openPlaceId) ?? null);
	planName = $derived(this.plan?.name ?? '');
	messages = $derived(this.plan?.messages ?? []);
	unread = $derived(this.shared && this.messages.length > this.#read);
	/** Ids of the participants who have the plan open right now. I am always one of them. */
	here = $derived(
		new Set([
			this.user.id,
			...Object.keys(this.#heard).filter((id) => this.#clock - this.#heard[id] < AWAY_AFTER_MS)
		])
	);
	/** The others who are sharing where they are. */
	friends = $derived(
		Object.entries(this.#positions).flatMap(([id, at]): Friend[] => {
			const age = this.#clock - at.at;
			if (id === this.user.id || age > POSITION_KEPT_MS) return [];
			return [{ id, lat: at.lat, lng: at.lng, minutes: Math.max(0, Math.floor(age / 60_000)) }];
		})
	);
	participants = $derived(
		Object.entries(this.plan?.participants ?? {}).map(([id, p]) => ({ id, ...p }))
	);
	selected = $derived(this.selectedId === null ? null : (this.#byId.get(this.selectedId) ?? null));
	/** The event ringed on the map: the one with its details open, or the open place. */
	ringed = $derived(this.selected ?? this.openPlace?.event ?? null);
	filtered = $derived.by(() => {
		const events = this.events.filter((e) => this.matches(e));
		if (!this.nearMe || !this.me) return events;
		// Events without a position go last.
		return events
			.map((event) => ({ event, metres: this.metresFromMe(event) ?? Infinity }))
			.sort((a, b) => a.metres - b.metres)
			.map((x) => x.event);
	});
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

		const user = load<{ id?: unknown; name?: unknown } | null>(ME_KEY, null);
		this.user = {
			id: typeof user?.id === 'string' ? user.id : crypto.randomUUID(),
			name: typeof user?.name === 'string' ? clean(user.name, MAX_NAME_LENGTH) : ''
		};
		save(ME_KEY, this.user);
		const plans = load<unknown>(PLANS_KEY, []);
		this.plans = (Array.isArray(plans) ? (plans as Partial<KnownPlan>[]) : [])
			.filter((p) => p && validPlanId(p.id))
			.map((p) => ({
				id: p.id!,
				name: typeof p.name === 'string' ? p.name : '',
				shared: isShared(p.id!)
			}));
		void this.readHash();
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
		if (event && from === 'map' && !this.filtered.includes(event)) this.clearFilters();
		if (!event) return this.close();
		this.selectedFrom = from;
		this.selectedId = event.id;
		if (from === 'list') this.focusTick++;
		// Opening details adds a history entry, so the browser's back button closes them.
		// Moving on to another event from there does not add more.
		if (!page.state.detail) void goto('', { shallow: true, state: { detail: true } });
	}

	/**
	 * Back from an event's details. Over the big map that is back to the map with the event
	 * still selected, where browsing left off; anywhere else the details just close.
	 */
	closeDetails() {
		if (this.bigMap && this.selectedFrom === 'list') this.selectedFrom = 'map';
		else this.close();
	}

	/** Closes the details. The page clears `selectedId` when the history entry goes away. */
	close() {
		if (page.state.detail) history.back();
		else this.selectedId = null;
	}

	/** Opens a place's panel in the plan, as tapping its chip does. */
	showPlace(id: number) {
		if (this.selectedId !== null) this.close();
		this.view = 'plan';
		this.bigMap = false;
		this.chatOpen = false;
		this.openPlaceId = id;
	}

	/** The star: adds the event to the plan, or offers to take it out again. */
	toggle(id: number) {
		if (this.picks.has(id)) {
			// It goes away for everyone, so it is never removed on a single tap.
			this.notify(this.t.removeForEveryone, {
				label: this.t.yesRemove,
				run: () => this.removePlace(id)
			});
		} else if (this.planState === 'ready') {
			void this.addPlace(id);
			this.notify(this.t.addedToPlan);
		}
	}

	/** New places always land in Unsorted. */
	async addPlace(id: number) {
		if (this.planState !== 'ready') return;
		if (!this.#handle) return this.#create([id]);
		const by = this.user.id;
		this.#handle.change((d) => {
			if (!d.places[id]) d.places[id] = newPlace(by);
		});
	}

	removePlace(id: number) {
		this.#handle?.change((d) => {
			delete d.places[id];
		});
	}

	/** Sets the tier and nothing else. Two people moving the same place: the last one wins. */
	setTier(id: number, tier: Tier) {
		const by = this.user.id;
		this.#handle?.change((d) => {
			const place = d.places[id];
			if (!place || place.tier === tier) return;
			place.tier = tier;
			place.movedBy = by;
		});
	}

	/** An empty name takes the name away. */
	async setPlanName(name: string) {
		name = clean(name, MAX_NAME_LENGTH);
		if (this.planState !== 'ready' || name === this.planName) return;
		if (!this.#handle) await this.#create();
		this.#handle?.change((d) => {
			if (name) d.name = name;
			else delete d.name;
		});
	}

	/** Starts an empty plan, private like every new one. The one left behind stays in the menu. */
	async newPlan() {
		if (this.selectedId !== null) this.close();
		await this.#create();
		this.view = 'plan';
	}

	/** Opens another of the plans this device knows. */
	switchPlan(id: string) {
		if (id === this.planId) return;
		if (this.selectedId !== null) this.close();
		void this.#open(id);
	}

	tierName(tier: number): string {
		return this.plan?.tierNames?.[tier] ?? '';
	}

	/** An empty name takes the name away. */
	async setTierName(tier: number, name: string) {
		name = clean(name, MAX_TIER_NAME_LENGTH);
		if (this.planState !== 'ready' || name === this.tierName(tier)) return;
		if (!this.#handle) await this.#create();
		this.#handle?.change((d) => {
			if (!d.tierNames) d.tierNames = {};
			if (name) d.tierNames[tier] = name;
			else delete d.tierNames[tier];
		});
	}

	/**
	 * Starts following where I am, for the map's dot and for sharing. Asks for permission the
	 * first time; `onFirst` runs once the first position is in.
	 */
	locate(onFirst?: (at: { lat: number; lng: number }) => void) {
		if (this.#watch !== undefined) return;
		if (!('geolocation' in navigator)) return this.notify(this.t.locationFailed);
		this.#watch = navigator.geolocation.watchPosition(
			(pos) => {
				const first = this.me === null;
				this.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				if (first) onFirst?.(this.me);
				this.#sendPosition();
			},
			() => {
				if (this.#watch !== undefined) navigator.geolocation.clearWatch(this.#watch);
				this.#watch = undefined;
				this.notify(this.t.locationFailed);
				this.stopSharingPosition();
			},
			{ enableHighAccuracy: true, maximumAge: 10_000 }
		);
	}

	/** Shows the others in a shared plan where I am, for the next quarter of an hour. */
	sharePosition() {
		this.requireName(() => {
			if (!this.shared || !this.#handle || this.sharingPosition) return;
			this.sharingPosition = true;
			this.#shareTimer = setTimeout(() => {
				this.stopSharingPosition();
				this.notify(this.t.positionEnded);
			}, SHARE_POSITION_MS);
			const note = { by: this.user.id, text: '', at: Date.now(), position: true as const };
			this.#handle.change((d) => {
				if (!d.messages) d.messages = [];
				d.messages.push(note);
			});
			this.locate();
			this.#sendPosition(true);
		});
	}

	stopSharingPosition() {
		if (!this.sharingPosition) return;
		clearTimeout(this.#shareTimer);
		this.sharingPosition = false;
		this.#sent = null;
		this.#handle?.broadcast({ at: { id: this.user.id, gone: true } });
	}

	/** `always`: also when I have not moved, so that someone who just arrived gets it. */
	#sendPosition(always = false) {
		const at = this.me;
		if (!this.sharingPosition || !at || document.visibilityState !== 'visible') return;
		if (!always && this.#sent && distance(this.#sent, at) < POSITION_STEP_METRES) return;
		this.#sent = at;
		this.#handle?.broadcast({ at: { id: this.user.id, lat: at.lat, lng: at.lng } });
	}

	/** Opens the chat, to write about a place when one is given. */
	openChat(about: number | null = null) {
		if (this.selectedId !== null) this.close();
		this.bigMap = false;
		this.chatAbout = about;
		this.chatOpen = true;
	}

	send(text: string) {
		text = clean(text, MAX_MESSAGE_LENGTH);
		if (!text) return;
		this.requireName(() => {
			const about = this.chatAbout;
			const message = {
				by: this.user.id,
				text,
				at: Date.now(),
				...(about === null ? {} : { place: about })
			};
			this.#handle?.change((d) => {
				if (!d.messages) d.messages = [];
				d.messages.push(message);
			});
			this.chatAbout = null;
		});
	}

	/** Everything in the chat so far has been seen. */
	markRead() {
		if (!this.#planId || this.#read === this.messages.length) return;
		this.#read = this.messages.length;
		save(READ_KEY, { ...load<Record<string, number>>(READ_KEY, {}), [this.#planId]: this.#read });
	}

	/** The closest other place in the plan, as the crow flies. */
	nearestPlace(from: Placed) {
		return this.places
			.map((p) => p.event)
			.filter((e) => e.id !== from.id)
			.filter(placed)
			.map((event) => ({ event, metres: distance(from, event) }))
			.reduce<{ event: Placed; metres: number } | null>(
				(best, x) => (best && best.metres <= x.metres ? best : x),
				null
			);
	}

	nameOf(participantId: string): string {
		return (
			this.plan?.participants[participantId]?.name ||
			(participantId === this.user.id ? this.t.you : this.t.someone)
		);
	}

	/** Runs `run` once I have a name, asking for it first if need be. */
	requireName(run: () => void) {
		if (this.user.name) return run();
		this.#afterName = run;
		this.naming = true;
		// The form is above the plan, under the big map.
		this.bigMap = false;
	}

	setName(name: string) {
		name = clean(name, MAX_NAME_LENGTH);
		if (!name) return;
		this.user = { ...this.user, name };
		save(ME_KEY, this.user);
		this.#register();
		const run = this.#afterName;
		this.cancelNaming();
		run?.();
	}

	cancelNaming() {
		this.naming = false;
		this.joining = false;
		this.#afterName = undefined;
	}

	/** Gives out the plan's link. A plan that is still private is only shared after asking. */
	invite() {
		if (!this.shared) return void (this.sharing = true);
		this.requireName(async () => {
			if (!this.#planId) return;
			const url = location.origin + location.pathname + location.search + `#plan=${this.#planId}`;
			const title = this.planName || this.t.appTitle;
			// The share sheet on phones; on a laptop a copied link is more useful.
			if (navigator.share && matchMedia('(pointer: coarse)').matches) {
				// Rejects when the user closes the share sheet; nothing to do then.
				await navigator.share({ title, url }).catch(() => {});
				return;
			}
			try {
				await navigator.clipboard.writeText(url);
				this.notify(this.t.planLinkCopied);
			} catch {
				window.prompt(this.t.copyLink, url);
			}
		});
	}

	/** Puts the plan online and gives out its link. Asked for in so many words: see `invite`. */
	async share() {
		this.sharing = false;
		if (this.planState !== 'ready') return;
		if (!this.#handle) await this.#create();
		if (!this.#planId) return;
		await sharePlan(this.#planId);
		this.shared = true;
		this.#startPresence();
		this.#remember();
		this.#writeHash();
		this.#register();
		this.invite();
	}

	/** Opens the plan in the URL hash (`#plan=<id>`), or else the plan last used here. */
	async readHash() {
		const linked = /[#&]plan=(\w+)/.exec(location.hash)?.[1];
		const fromLink = validPlanId(linked) ? linked : null;
		if (fromLink && fromLink === this.#planId) return;

		let mine = load<unknown>(PLAN_KEY, null);
		if (!validPlanId(mine)) {
			// First visit since the plan replaced the lists: the old picks start my plan.
			const old = this.#oldPicks();
			if (old.length) {
				await this.#create(old);
				this.view = 'plan';
			}
			mine = this.#planId;
		}
		if (fromLink && fromLink !== mine) await this.#open(fromLink, true);
		else if (validPlanId(mine) && mine !== this.#planId) await this.#open(mine);
		else this.#writeHash();
	}

	/** Tries the plan that could not be opened once more. */
	retryPlan() {
		if (this.#planId) void this.#open(this.#planId);
		else void this.#create();
	}

	/** Gives up on a plan that could not be opened. */
	startNewPlan() {
		void this.#create();
	}

	/** `fromLink`: the plan is someone's, opened from their link, and so shared by definition. */
	async #open(id: string, fromLink = false) {
		this.#attach(undefined);
		this.#planId = id;
		this.planState = 'loading';
		this.view = 'plan';
		try {
			const handle = await findPlan(id, fromLink);
			// Another plan was asked for while this one was on its way.
			if (this.#planId !== id) return;
			// A link to some other kind of document.
			if (!readPlan(handle.doc())) throw new Error(`${id} is not a plan`);
			this.#attach(handle);
		} catch (err) {
			console.error(err);
			if (this.#planId === id) this.planState = 'missing';
			return;
		}
		if (fromLink && !this.user.name) this.naming = this.joining = true;
	}

	async #create(eventIds: number[] = []) {
		const by = this.user.id;
		const places = Object.fromEntries(eventIds.map((id) => [id, newPlace(by)]));
		try {
			this.#attach(await createPlan({ places, participants: {} }));
		} catch (err) {
			console.error(err);
			this.planState = 'missing';
		}
	}

	/** Every change of plan goes through here. */
	#attach(handle: DocHandle<PlanDoc> | undefined) {
		this.#handle?.off('change', this.#onChange);
		this.#stopPresence();
		this.#handle = handle;
		this.#planId = this.planId = handle?.documentId ?? null;
		this.plan = handle ? readPlan(handle.doc()) : null;
		this.planState = 'ready';
		this.openPlaceId = null;
		this.shared = handle ? isShared(handle.documentId) : false;
		this.chatOpen = false;
		const read =
			handle && load<Record<string, unknown> | null>(READ_KEY, null)?.[handle.documentId];
		this.#read = typeof read === 'number' ? read : 0;
		if (!handle) return;
		handle.on('change', this.#onChange);
		save(PLAN_KEY, handle.documentId);
		this.#remember();
		this.#writeHash();
		this.#register();
		this.#startPresence();
	}

	/** Tells the others I am here, now and for as long as the plan is open. Shared plans only. */
	#startPresence() {
		const handle = this.#handle;
		if (!handle || !this.shared || this.#presence) return;
		handle.on('ephemeral-message', this.#onPresence);
		const beat = () => {
			this.#clock = Date.now();
			// A hidden tab is not someone looking at the plan.
			if (document.visibilityState === 'visible') handle.broadcast({ here: this.user.id });
			this.#sendPosition(true);
		};
		beat();
		this.#presence = setInterval(beat, HERE_EVERY_MS);
	}

	#stopPresence() {
		clearInterval(this.#presence);
		this.#presence = undefined;
		this.stopSharingPosition();
		this.#handle?.off('ephemeral-message', this.#onPresence);
		this.#heard = {};
		this.#positions = {};
	}

	#onPresence = ({ message }: { message: unknown }) => {
		const { here, gone, at } = (message ?? {}) as Record<string, unknown>;
		if (typeof gone === 'string') {
			this.#heard = { ...this.#heard, [gone]: 0 };
		} else if (typeof here === 'string') {
			// Someone who just arrived should not have to wait a round to see me.
			if (!this.here.has(here)) {
				this.#handle?.broadcast({ here: this.user.id });
				this.#sendPosition(true);
			}
			this.#heard = { ...this.#heard, [here]: Date.now() };
		} else if (typeof at === 'object' && at !== null) {
			const { id, lat, lng, gone } = at as Record<string, unknown>;
			if (typeof id !== 'string') return;
			const positions = { ...this.#positions };
			if (gone === true) delete positions[id];
			else if (Number.isFinite(lat) && Number.isFinite(lng)) {
				positions[id] = { lat: lat as number, lng: lng as number, at: Date.now() };
			} else return;
			this.#positions = positions;
		}
	};

	/** Leaving the page: say so, so the others need not wait for the silence. */
	leave() {
		this.stopSharingPosition();
		if (this.#presence) this.#handle?.broadcast({ gone: this.user.id });
	}

	/** Keeps the menu's list of plans up to date with the one that is open. */
	#remember() {
		const id = this.#planId;
		if (!id) return;
		const known = this.plans.find((p) => p.id === id);
		if (known && known.name === this.planName && known.shared === this.shared) return;
		const plan = { id, name: this.planName, shared: this.shared };
		this.plans = known ? this.plans.map((p) => (p.id === id ? plan : p)) : [...this.plans, plan];
		save(PLANS_KEY, this.plans);
	}

	#onChange = ({ doc }: { doc: PlanDoc }) => {
		this.plan = readPlan(doc) ?? this.plan;
		this.#remember();
	};

	/**
	 * Puts me among the plan's participants, once I have a name, and says so in the chat of a
	 * shared plan the first time.
	 */
	#register() {
		const { id, name } = this.user;
		if (!name || !this.#handle) return;
		const announced = !this.shared || this.messages.some((m) => m.joined && m.by === id);
		if (this.plan?.participants[id]?.name === name && announced) return;
		this.#handle.change((d) => {
			if (d.participants[id]) d.participants[id].name = name;
			else {
				const taken = Object.values(d.participants).map((p) => p.colour);
				d.participants[id] = {
					name,
					colour: COLOURS.find((c) => !taken.includes(c)) ?? COLOURS[taken.length % COLOURS.length]
				};
			}
			if (announced) return;
			if (!d.messages) d.messages = [];
			d.messages.push({ by: id, text: '', at: Date.now(), joined: true });
		});
	}

	#oldPicks(): number[] {
		const known = (ids: unknown) =>
			Array.isArray(ids) ? ids.filter((id) => this.#byId.has(id)) : [];
		const stored = load<{ lists?: unknown; activeId?: unknown } | null>(OLD_LISTS_KEY, null);
		const lists = Array.isArray(stored?.lists)
			? (stored.lists as { id?: unknown; picks?: unknown }[])
			: [];
		const active = lists.find((l) => l?.id === stored?.activeId) ?? lists[0];
		return known(active ? active.picks : load<unknown>(OLD_PICKS_KEY, []));
	}

	#writeHash() {
		// A private plan has no link to give away by copying the address.
		const hash = this.#planId && this.shared ? `#plan=${this.#planId}` : '';
		if (location.hash === hash) return;
		// Keep page.state: it is what says the details are open.
		void goto(location.pathname + location.search + hash, {
			replace: true,
			shallow: true,
			state: page.state
		});
	}
}

export const planner = new Planner();
