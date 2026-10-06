// Rough distances between venues. There is no routing: times are straight-line distance
// stretched by a detour factor, so they are only a guide (and optimistic across the harbour).

const DETOUR = 1.3;
const WALK_M_PER_MIN = 80; // 4.8 km/h
const BIKE_M_PER_MIN = 250; // 15 km/h

type Point = { lat: number; lng: number };

/** Straight-line distance in metres. */
export function distance(a: Point, b: Point): number {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLng = (b.lng - a.lng) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const walkMinutes = (metres: number) =>
	Math.max(1, Math.round((metres * DETOUR) / WALK_M_PER_MIN));
export const bikeMinutes = (metres: number) =>
	Math.max(1, Math.round((metres * DETOUR) / BIKE_M_PER_MIN));

export function formatDistance(metres: number): string {
	return metres < 950
		? `${Math.max(50, Math.round(metres / 50) * 50)} m`
		: `${(metres / 1000).toFixed(1)} km`;
}
