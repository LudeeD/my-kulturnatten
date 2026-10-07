<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { asset } from '$app/paths';
	import {
		AttributionControl,
		LngLatBounds,
		Map as MapLibre,
		Popup,
		setWorkerUrl,
		type FilterSpecification,
		type GeoJSONSource
	} from 'maplibre-gl';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { shortName, STRONG, tierStrength } from '#lib/plan.ts';
	import { placed, planner, type Place, type TransitKind } from '#lib/planner.svelte.ts';
	import { range } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';
	import FavButton from './FavButton.svelte';

	setWorkerUrl(workerUrl);

	// OpenFreeMap: free vector tiles, no API key. Attribution comes with the style and is
	// shown by the AttributionControl below.
	// The map follows the system's light or dark setting, like the rest of the app (layout.css).
	// It is decided once: the map does not restyle itself if the setting changes while open.
	const dark = matchMedia('(prefers-color-scheme: dark)').matches;
	const STYLE = `https://tiles.openfreemap.org/styles/${dark ? 'fiord' : 'positron'}`;
	const C = dark
		? {
				bg: '#0e1630',
				fg: '#eef0f8',
				muted: '#a0abc8',
				ink: '#2a1c00',
				train: '#c4bbff',
				others: '#c9d1e6',
				cluster: '#18223f',
				ring: '#8fc1ff',
				pick: '#ffc857',
				raised: '#18223f',
				pinStroke: '#ffffff'
			}
		: {
				bg: '#ffffff',
				fg: '#121a33',
				muted: '#56617f',
				ink: '#2a1c00',
				train: '#6a5ae0',
				others: '#7b86a3',
				cluster: '#56617f',
				ring: '#1d4fbf',
				pick: '#f5b83d',
				raised: '#ffffff',
				pinStroke: '#121a33'
			};
	const COPENHAGEN: [number, number] = [12.572, 55.68];
	// How far around a tap to look for a marker: the quiet dots are too small to hit exactly.
	const TAP_RADIUS = 16;

	// Train lines and train stations come from the map tiles, where the base styles draw them
	// almost invisibly. The tiles only have metro tracks from zoom 14 and do not say which line
	// is which, so the metro lines and stations come from our own small file
	// (scripts/fetch-metro.ts), which knows their names and colours.
	const TRAIN = C.train;
	// Stations are background: the events are what the map is for.
	const STATION_OPACITY = 0.6;
	const TRANSIT_LAYERS: Record<TransitKind, string[]> = {
		metroLines: ['metro-lines', 'metro-line-names'],
		metroStations: ['metro-stations', 'metro-station-names'],
		trainLines: ['train-lines'],
		trainStations: ['train-stations', 'train-station-names']
	};
	const isMetro = ['==', ['get', 'subclass'], 'subway'] as ['==', ['get', string], string];

	// The plan's pins: tier 1 is the strongest, fading down to the last. The same mix as the
	// rows (PlanView). Unsorted is tier 0 here, drawn hollow with a dashed outline.
	const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	function tierColours(tier: number) {
		const strength = tierStrength(tier, planner.usedTiers);
		const [pick, raised] = [channels(C.pick), channels(C.raised)];
		const mixed = pick.map((p, i) => Math.round(p * strength + raised[i] * (1 - strength)));
		const strong = strength >= STRONG;
		return {
			fill: `rgb(${mixed.join(',')})`,
			stroke: strong ? C.pinStroke : C.muted,
			text: strong ? C.ink : C.fg
		};
	}
	const PIN_RADIUS = 14;

	/** The hollow, dashed pin of an unsorted place. Circle layers cannot draw dashes. */
	function unsortedPin() {
		const ratio = 2;
		const size = (PIN_RADIUS + 2) * 2;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size * ratio;
		const ctx = canvas.getContext('2d')!;
		ctx.scale(ratio, ratio);
		ctx.arc(size / 2, size / 2, PIN_RADIUS, 0, Math.PI * 2);
		// Just enough fill to keep the "?" readable over the streets.
		ctx.globalAlpha = 0.6;
		ctx.fillStyle = C.bg;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.setLineDash([4.4, 3.6]);
		ctx.lineWidth = 2;
		ctx.strokeStyle = C.muted;
		ctx.stroke();
		return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), pixelRatio: ratio };
	}

	// Below this zoom the quiet dots are grouped, or the city centre is an untappable smear.
	const CLUSTER_BELOW_ZOOM = 14;

	interface Props {
		/** The small map above the plan on a phone: only the plan, always all of it, not movable. */
		small?: boolean;
		/** Show a popup at the selected marker. */
		popup?: boolean;
	}
	let { small = false, popup: showPopup = true }: Props = $props();

	let container: HTMLDivElement;
	let popupEl: HTMLDivElement;
	let map: MapLibre | undefined;
	let popup: Popup | undefined;
	let ready = $state(false);

	const t = $derived(planner.t);
	const selected = $derived(planner.selected);

	// The top leaves room for the popup, which always opens above its marker.
	const padding = () =>
		small
			? { top: 30, bottom: 26, left: 36, right: 36 }
			: { top: showPopup ? 240 : 70, bottom: 30, left: 40, right: 60 };

	const points = (events: KnEvent[]) => ({
		type: 'FeatureCollection' as const,
		features: events.filter(placed).map((e) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] },
			properties: { id: e.id, pick: planner.picks.has(e.id) }
		}))
	});
	const pins = (places: Place[]) => ({
		type: 'FeatureCollection' as const,
		features: places.flatMap(({ event: e, tier }) =>
			placed(e)
				? {
						type: 'Feature' as const,
						geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] },
						properties: {
							id: e.id,
							pick: true,
							tier: tier ?? 0,
							...(tier ? tierColours(tier) : { text: C.fg }),
							label: tier ? String(tier) : '?',
							name: shortName(planner.tr(e.organizer))
						}
					}
				: []
		)
	});
	const source = (id: string) => map!.getSource(id) as GeoJSONSource;

	function flyTo(at: { lat: number; lng: number }) {
		map?.flyTo({
			center: [at.lng, at.lat],
			zoom: Math.max(map.getZoom(), 15),
			padding: padding(),
			duration: 900
		});
	}

	/** Shows the user's position and moves the map there. Asks for permission the first time. */
	export function locate() {
		if (planner.me) flyTo(planner.me);
		else planner.locate(flyTo);
	}

	export function fitPicks(duration = 900) {
		const picks = planner.events.filter((e) => planner.picks.has(e.id)).filter(placed);
		if (!map || picks.length === 0) return;
		const bounds = new LngLatBounds();
		for (const e of picks) bounds.extend([e.lng, e.lat]);
		map.fitBounds(bounds, { padding: padding(), maxZoom: 15.5, duration });
	}

	onMount(() => {
		const m = new MapLibre({
			container,
			style: STYLE,
			center: COPENHAGEN,
			zoom: 12.3,
			attributionControl: false,
			dragRotate: false,
			pitchWithRotate: false
		});
		m.touchZoomRotate.disableRotation();
		// Top-left and never collapsed, so it stays readable above the pull-up list.
		m.addControl(new AttributionControl({ compact: false }), 'top-left');

		popup = new Popup({
			closeButton: false,
			closeOnClick: false,
			focusAfterOpen: false,
			// Never below the marker: on a phone that is where the list is.
			anchor: 'bottom',
			offset: 16,
			maxWidth: '290px'
		}).setDOMContent(popupEl);

		m.on('load', () => {
			const empty = { type: 'FeatureCollection' as const, features: [] };
			const unsorted = unsortedPin();
			m.addImage('unsorted', unsorted.image, { pixelRatio: unsorted.pixelRatio });
			// Picks are never clustered; the rest is, when zoomed out.
			m.addSource('others', {
				type: 'geojson',
				data: empty,
				cluster: true,
				clusterMaxZoom: CLUSTER_BELOW_ZOOM - 1,
				clusterRadius: 34
			});
			m.addSource('picks', { type: 'geojson', data: empty });
			m.addSource('selected', { type: 'geojson', data: empty });
			m.addSource('me', { type: 'geojson', data: empty });
			m.addSource('friends', { type: 'geojson', data: empty });
			m.addSource('metro', { type: 'geojson', data: asset('data/metro.json') });
			m.addLayer({
				id: 'train-lines',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				filter: [
					'all',
					['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
					['!', isMetro],
					// Sidings and yards.
					['!', ['has', 'service']]
				],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': TRAIN,
					'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4],
					'line-opacity': 0.7
				}
			});
			m.addLayer({
				id: 'metro-lines',
				type: 'line',
				source: 'metro',
				filter: ['==', ['get', 'kind'], 'line'],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': ['get', 'colour'],
					'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 5],
					'line-opacity': 0.85
				}
			});
			m.addLayer({
				id: 'metro-line-names',
				type: 'symbol',
				source: 'metro',
				filter: ['==', ['get', 'kind'], 'line'],
				layout: {
					'symbol-placement': 'line',
					'symbol-spacing': 220,
					'text-field': ['get', 'ref'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-rotation-alignment': 'viewport'
				},
				paint: {
					'text-color': ['get', 'colour'],
					'text-halo-color': C.bg,
					'text-halo-width': 2
				}
			});
			const trainStation: FilterSpecification = [
				'all',
				['==', ['get', 'class'], 'railway'],
				['in', ['get', 'subclass'], ['literal', ['station', 'halt']]]
			];
			m.addLayer({
				id: 'train-stations',
				type: 'circle',
				source: 'openmaptiles',
				'source-layer': 'poi',
				minzoom: 12,
				filter: trainStation,
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 5],
					'circle-color': C.bg,
					'circle-opacity': STATION_OPACITY,
					'circle-stroke-color': TRAIN,
					'circle-stroke-opacity': STATION_OPACITY,
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'train-station-names',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'poi',
				minzoom: 14,
				filter: trainStation,
				layout: {
					'text-field': ['get', 'name'],
					'text-font': ['Noto Sans Regular'],
					'text-size': 12,
					'text-anchor': 'top',
					'text-offset': [0, 0.6]
				},
				paint: {
					'text-color': TRAIN,
					'text-opacity': STATION_OPACITY,
					'text-halo-color': C.bg,
					'text-halo-width': 1.5
				}
			});
			// A station has one point per line it is on, numbered by `ring`: an interchange is
			// drawn as concentric rings, one in each line's colour, largest first.
			m.addLayer({
				id: 'metro-stations',
				type: 'circle',
				source: 'metro',
				filter: ['==', ['get', 'kind'], 'station'],
				layout: { 'circle-sort-key': ['-', ['get', 'ring']] },
				paint: {
					'circle-radius': [
						'interpolate',
						['linear'],
						['zoom'],
						11,
						['+', 1.5, ['*', 1.5, ['get', 'ring']]],
						16,
						['+', 4, ['*', 3, ['get', 'ring']]]
					],
					'circle-color': C.bg,
					'circle-opacity': STATION_OPACITY,
					'circle-stroke-color': ['get', 'colour'],
					'circle-stroke-opacity': STATION_OPACITY,
					'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2.5]
				}
			});
			m.addLayer({
				id: 'metro-station-names',
				type: 'symbol',
				source: 'metro',
				minzoom: 14,
				filter: ['all', ['==', ['get', 'kind'], 'station'], ['==', ['get', 'ring'], 0]],
				layout: {
					'text-field': ['get', 'name'],
					'text-font': ['Noto Sans Regular'],
					'text-size': 12,
					'text-anchor': 'top',
					'text-offset': [0, 1]
				},
				paint: {
					// The rings carry the line colours; dark green or red text is hard to read here.
					'text-color': C.muted,
					'text-halo-color': C.bg,
					'text-halo-width': 1.5
				}
			});
			m.addLayer({
				id: 'clusters',
				type: 'circle',
				source: 'others',
				filter: ['has', 'point_count'],
				paint: {
					'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 30, 21],
					'circle-color': C.cluster,
					'circle-opacity': 0.9,
					'circle-stroke-color': C.bg,
					'circle-stroke-width': 1
				}
			});
			m.addLayer({
				id: 'cluster-counts',
				type: 'symbol',
				source: 'others',
				filter: ['has', 'point_count'],
				layout: {
					'text-field': ['get', 'point_count_abbreviated'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-allow-overlap': true
				},
				paint: { 'text-color': '#f3f5f9' }
			});
			// Everything that is not a pick: visible but quiet.
			m.addLayer({
				id: 'others',
				type: 'circle',
				source: 'others',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 15, 7],
					'circle-color': C.others,
					'circle-stroke-color': C.bg,
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'picks',
				type: 'circle',
				source: 'picks',
				filter: ['!=', ['get', 'tier'], 0],
				paint: {
					'circle-radius': PIN_RADIUS,
					'circle-color': ['get', 'fill'],
					'circle-stroke-color': ['get', 'stroke'],
					'circle-stroke-width': 2
				}
			});
			m.addLayer({
				id: 'unsorted',
				type: 'symbol',
				source: 'picks',
				filter: ['==', ['get', 'tier'], 0],
				layout: {
					'icon-image': 'unsorted',
					'icon-allow-overlap': true,
					'icon-ignore-placement': true
				}
			});
			m.addLayer({
				id: 'pick-numbers',
				type: 'symbol',
				source: 'picks',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 13,
					'text-allow-overlap': true,
					// Always drawn, and wide enough to keep the names off the pins.
					'text-padding': 9
				},
				paint: { 'text-color': ['get', 'text'] }
			});
			// Beside the pin, on whichever side there is room. A name that fits nowhere is left out.
			m.addLayer({
				id: 'pick-names',
				type: 'symbol',
				source: 'picks',
				layout: {
					'text-field': ['get', 'name'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
					'text-radial-offset': 1.5,
					'text-justify': 'auto'
				},
				paint: {
					'text-color': C.fg,
					'text-halo-color': C.bg,
					'text-halo-width': 1.5
				}
			});
			m.addLayer({
				id: 'selected',
				type: 'circle',
				source: 'selected',
				paint: {
					'circle-radius': ['case', ['get', 'pick'], 19, 11],
					'circle-color': 'rgba(0,0,0,0)',
					'circle-stroke-color': C.ring,
					'circle-stroke-width': 3
				}
			});
			m.addLayer({
				id: 'me',
				type: 'circle',
				source: 'me',
				paint: {
					'circle-radius': 8,
					'circle-color': '#3b9dff',
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 3
				}
			});
			// The others who share where they are: their avatar, with their name under it.
			m.addLayer({
				id: 'friends',
				type: 'circle',
				source: 'friends',
				paint: {
					'circle-radius': 11,
					'circle-color': ['get', 'colour'],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2.5
				}
			});
			m.addLayer({
				id: 'friend-initials',
				type: 'symbol',
				source: 'friends',
				layout: {
					'text-field': ['get', 'initial'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-allow-overlap': true,
					'text-ignore-placement': true
				},
				paint: { 'text-color': C.ink }
			});
			m.addLayer({
				id: 'friend-names',
				type: 'symbol',
				source: 'friends',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-anchor': 'top',
					'text-offset': [0, 1.1],
					'text-allow-overlap': true,
					'text-ignore-placement': true
				},
				paint: { 'text-color': C.fg, 'text-halo-color': C.bg, 'text-halo-width': 1.5 }
			});
			ready = true;
		});

		m.on('click', async (ev) => {
			const { x, y } = ev.point;
			const hits = m.queryRenderedFeatures(
				[
					[x - TAP_RADIUS, y - TAP_RADIUS],
					[x + TAP_RADIUS, y + TAP_RADIUS]
				],
				{ layers: ['clusters', 'others', 'picks', 'unsorted'] }
			);
			let best: (typeof hits)[number] | undefined;
			let bestDistance = Infinity;
			for (const f of hits) {
				if (f.geometry.type !== 'Point') continue;
				const at = m.project(f.geometry.coordinates as [number, number]);
				// Picks win when a quiet dot is about as close.
				const distance = Math.hypot(at.x - x, at.y - y) - (f.properties.pick ? 8 : 0);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = f;
				}
			}
			if (!best || best.geometry.type !== 'Point') return planner.close();
			if (best.properties.cluster) {
				// A group of events: zoom in until it splits.
				const zoom = await source('others').getClusterExpansionZoom(best.properties.cluster_id);
				m.easeTo({ center: best.geometry.coordinates as [number, number], zoom, duration: 500 });
			} else if (best.properties.pick) {
				planner.showPlace(best.properties.id);
			} else {
				planner.select(best.properties.id, 'map');
			}
		});
		for (const layer of ['clusters', 'others', 'picks', 'unsorted']) {
			m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
		}

		map = m;
		return () => m.remove();
	});

	// Markers: every place in the plan, plus whatever matches the search and filters unless others are hidden.
	$effect(() => {
		if (!ready || !map) return;
		const picks = planner.picks;
		source('picks').setData(pins(planner.places));
		source('others').setData(
			points(
				planner.hideOthers || small
					? []
					: planner.events.filter((e) => !picks.has(e.id) && planner.matches(e))
			)
		);
	});

	$effect(() => {
		if (!ready || !map) return;
		const me = planner.me;
		source('me').setData({
			type: 'FeatureCollection',
			features: me
				? [
						{
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [me.lng, me.lat] },
							properties: {}
						}
					]
				: []
		});
	});

	$effect(() => {
		if (!ready || !map) return;
		source('friends').setData({
			type: 'FeatureCollection',
			features: planner.friends.map((friend) => {
				const name = planner.nameOf(friend.id);
				return {
					type: 'Feature' as const,
					geometry: { type: 'Point' as const, coordinates: [friend.lng, friend.lat] },
					properties: {
						colour: planner.plan?.participants[friend.id]?.colour ?? C.muted,
						initial: [...name][0]?.toUpperCase() ?? '',
						label: friend.minutes ? `${name} · ${t.minutesAgo(friend.minutes)}` : name
					}
				};
			})
		});
	});

	$effect(() => {
		if (!ready || !map) return;
		for (const [kind, layers] of Object.entries(TRANSIT_LAYERS) as [TransitKind, string[]][]) {
			const visibility = planner.transit[kind] ? 'visible' : 'none';
			for (const layer of layers) map.setLayoutProperty(layer, 'visibility', visibility);
		}
	});

	$effect(() => {
		if (!ready || !map) return;
		// Its own source, so the ring shows even when the event is hidden or inside a cluster.
		void planner.picks;
		source('selected').setData(points(planner.ringed ? [planner.ringed] : []));
	});

	$effect(() => {
		if (!ready || !map || !popup) return;
		const ringed = planner.ringed;
		if (!selected || !placed(selected) || !showPopup) popup.remove();
		else popup.setLngLat([selected.lng, selected.lat]).addTo(map);
		if (!ringed || !placed(ringed)) return;
		// A marker tapped near an edge or just above the list, or a chip whose pin is out of
		// view: nudge it into the clear. Events opened from the list are flown to instead.
		const at: [number, number] = [ringed.lng, ringed.lat];
		const { top, bottom, left, right } = padding();
		const { x, y } = map.project(at);
		const hidden =
			y < top ||
			y > container.clientHeight - bottom ||
			x < left ||
			x > container.clientWidth - right;
		if (hidden && (!selected || untrack(() => planner.selectedFrom) === 'map')) {
			map.easeTo({ center: at, padding: padding(), duration: 400 });
		}
	});

	// The small map cannot be moved by hand, so it keeps the whole plan in view.
	$effect(() => {
		if (!ready || !map || !small) return;
		void planner.places;
		void tick().then(() => {
			// Its box has just changed size when coming back from the big map.
			map?.resize();
			fitPicks(0);
		});
	});

	// Fly to the selection when the list (or "show on map") asks for it.
	$effect(() => {
		void planner.focusTick;
		if (!ready || !map) return;
		untrack(() => {
			const e = planner.selected;
			if (e && placed(e)) flyTo(e);
		});
	});
</script>

<div bind:this={container} class="h-full w-full {small ? 'small-map' : ''}"></div>

<!-- Handed to the MapLibre popup, which moves it next to the selected marker. -->
<div class="hidden">
	<div bind:this={popupEl} class="w-64 space-y-2">
		{#if selected}
			<div>
				<p class="leading-snug font-semibold">
					{#if selected.no}<span class="text-pick tabular-nums">{selected.no}</span>{/if}
					{planner.tr(selected.title)}
				</p>
				<p class="text-sm text-muted">{planner.tr(selected.organizer)}</p>
				<p class="text-sm text-muted">
					{range(selected.start, selected.end)}
					{#if selected.signupRequired}<span class="text-warn"> · {t.signupRequired}</span>{/if}
				</p>
			</div>
			<div class="flex items-center gap-3">
				<FavButton id={selected.id} withLabel />
				<!-- Phone: the details are a screen of their own. -->
				<button type="button" class="link md:hidden" onclick={() => planner.select(selected.id)}>
					{t.details}
				</button>
			</div>
		{/if}
	</div>
</div>
