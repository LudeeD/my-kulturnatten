/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Keeps the app and the programme usable when the network drops, which it does in a crowd.
// Map tiles are not cached: without a connection the map is blank, but the list still works.

import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = 'kulturnatten-2026';

// Manifest paths are relative to the app's base, and so is this worker's scope.
const url = (path: string) => new URL(path, self.registration.scope).href;
const hashed = new Set(immutable.map((f) => url(f.path)));
const precache = [
	...hashed,
	...assets.map((f) => url(f.path)),
	...prerendered.map((f) => url(f.path))
];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(precache)));
});

self.addEventListener('activate', (event) => {
	// Drop build files left over from earlier deployments.
	event.waitUntil(
		caches.open(CACHE).then(async (cache) => {
			for (const request of await cache.keys()) {
				if (request.url.includes('/immutable/') && !hashed.has(request.url)) {
					await cache.delete(request);
				}
			}
		})
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Build files have a content hash in their name: a cached copy is always right.
			if (hashed.has(request.url)) {
				const cached = await cache.match(request);
				if (cached) return cached;
			}
			// Everything else (the page, the programme) is fetched fresh when possible, so a
			// new deployment or an amended programme shows up at once. The cache is the fallback.
			try {
				const response = await fetch(request);
				if (response.ok) await cache.put(request, response.clone());
				return response;
			} catch (err) {
				const cached = await cache.match(request, { ignoreSearch: true });
				if (cached) return cached;
				throw err;
			}
		})()
	);
});
