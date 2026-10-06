// Shape of static/data/events.json, written by scripts/fetch-events.ts and loaded by the app.

/** Minutes after 18:00 on the night. 18:00 = 0, 23:30 = 330, midnight = 360, 01:00 = 420. */
export type Minutes = number;

export interface Localized {
	da: string;
	en: string;
}

export interface TimeSlot {
	start: Minutes;
	end: Minutes;
}

export interface SubEvent {
	title: Localized;
	description: Localized;
	start: Minutes;
	/** null when the source gives no usable end time (missing, or not after the start). */
	end: Minutes | null;
	/** Fixed performance/tour times within start–end. Empty when it simply runs continuously. */
	slots: TimeSlot[];
	signupUrl: string | null;
	childFriendly: boolean;
	accessible: boolean;
}

export interface KnEvent {
	/** WordPress post id of the Danish programme entry. */
	id: number;
	/** Programme number as printed in the official programme, e.g. 201. Unique per event. */
	no: number;
	area: string;
	organizer: Localized;
	title: Localized;
	description: Localized;
	address: string;
	zip: string;
	city: string;
	/** null when the source has no coordinates at all. */
	lat: number | null;
	lng: number | null;
	/** true when coordinates are missing or fall outside greater Copenhagen. */
	badCoords: boolean;
	start: Minutes;
	end: Minutes;
	/** Danish labels from the source, e.g. "Rundvisning", "Workshop". */
	types: string[];
	/** Danish age-group labels from the source, e.g. "Børn 5 - 8", "Voksne". */
	audience: string[];
	/** Danish labels from the source, e.g. "Barnevognsadgang". */
	practical: string[];
	childFriendly: boolean;
	signupRequired: boolean;
	signupUrl: string | null;
	website: string | null;
	/** Rejseplanen link. */
	itineraryUrl: string | null;
	image: string | null;
	/** Late change announced by the organisers (Danish only), or null. */
	amendment: string | null;
	subEvents: SubEvent[];
}

export interface Programme {
	fetchedAt: string;
	source: string;
	count: number;
	events: KnEvent[];
}
