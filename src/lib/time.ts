import type { Minutes, SubEvent } from './types.ts';

const EVENING_START = 18 * 60;

/** Minutes after 18:00 to "HH:MM". */
export function clock(m: Minutes): string {
	const total = (m + EVENING_START) % (24 * 60);
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const range = (start: Minutes, end: Minutes) => `${clock(start)}–${clock(end)}`;

export function subEventTime(sub: SubEvent, words: { from: string; allEvening: string }): string {
	if (sub.slots.length > 0) return sub.slots.map((s) => range(s.start, s.end)).join(', ');
	if (sub.end !== null) return range(sub.start, sub.end);
	if (sub.start > 0) return `${words.from} ${clock(sub.start)}`;
	return words.allEvening;
}
