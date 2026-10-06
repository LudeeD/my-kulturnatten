<script lang="ts">
	import { onMount, untrack } from 'svelte';
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
	import { placed, planner, type TransitKind } from '#lib/planner.svelte.ts';
	import { range } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';
	import FavButton from './FavButton.svelte';

	setWorkerUrl(workerUrl);

	// OpenFreeMap: free vector tiles, no API key. Attribution comes with the style and is
	// shown by the AttributionControl below.
	const STYLE = 'https://tiles.openfreemap.org/styles/dark';
	const COPENHAGEN: [number, number] = [12.572, 55.68];
	// How far around a tap to look for a marker: the quiet dots are too small to hit exactly.
	const TAP_RADIUS = 16;

	// Train lines and train stations come from the map tiles, where the dark style draws them
	// almost invisibly. The tiles only have metro tracks from zoom 14 and do not say which line
	// is which, so the metro lines and stations come from our own small file
	// (scripts/fetch-metro.ts), which knows their names and colours.
	const TRAIN = '#a79bff';
	// Stations are background: the events are what the map is for.
	const STATION_OPACITY = 0.6;
	const TRANSIT_LAYERS: Record<TransitKind, string[]> = {
		metroLines: ['metro-lines', 'metro-line-names'],
		metroStations: ['metro-stations', 'metro-station-names'],
		trainLines: ['train-lines'],
		trainStations: ['train-stations', 'train-station-names']
	};
	const isMetro = ['==', ['get', 'subclass'], 'subway'] as ['==', ['get', string], string];

	// Below this zoom the quiet dots are grouped, or the city centre is an untappable smear.
	const CLUSTER_BELOW_ZOOM = 14;

	interface Props {
		/** Height of the pull-up list covering the bottom of the map (phone only). */
		inset?: number;
		/** Show a popup at the selected marker. Off on phones, where the list shows the event. */
		popup?: boolean;
	}
	let { inset = 0, popup: showPopup = true }: Props = $props();

	let container: HTMLDivElement;
	let popupEl: HTMLDivElement;
	let map: MapLibre | undefined;
	let popup: Popup | undefined;
	let ready = $state(false);

	const t = $derived(planner.t);
	const selected = $derived(planner.selected);

	// The top leaves room for the popup, which always opens above its marker.
	const padding = () => ({ top: showPopup ? 240 : 70, bottom: inset + 30, left: 40, right: 60 });

	const points = (events: KnEvent[]) => ({
		type: 'FeatureCollection' as const,
		features: events.filter(placed).map((e) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] },
			properties: { id: e.id, label: e.no ? String(e.no) : '★', pick: planner.picks.has(e.id) }
		}))
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

	let watching = false;
	/** Shows the user's position and moves the map there. Asks for permission the first time. */
	export function locate() {
		if (planner.me) return flyTo(planner.me);
		if (watching) return;
		if (!('geolocation' in navigator)) return planner.notify(t.locationFailed);
		watching = true;
		navigator.geolocation.watchPosition(
			(pos) => {
				const first = planner.me === null;
				planner.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				if (first) flyTo(planner.me);
			},
			() => {
				watching = false;
				planner.notify(t.locationFailed);
			},
			{ enableHighAccuracy: true, maximumAge: 10_000 }
		);
	}

	export function fitPicks() {
		const picks = planner.events.filter((e) => planner.picks.has(e.id)).filter(placed);
		if (!map || picks.length === 0) return;
		const bounds = new LngLatBounds();
		for (const e of picks) bounds.extend([e.lng, e.lat]);
		map.fitBounds(bounds, { padding: padding(), maxZoom: 15.5, duration: 900 });
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
					'text-halo-color': '#0b0d12',
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
					'circle-color': '#0b0d12',
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
					'text-halo-color': '#0b0d12',
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
					'circle-color': '#0b0d12',
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
					'text-color': '#aeb6c5',
					'text-halo-color': '#0b0d12',
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
					'circle-color': '#55607a',
					'circle-opacity': 0.9,
					'circle-stroke-color': '#0b0d12',
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
					'circle-color': '#9aa5bd',
					'circle-stroke-color': '#0b0d12',
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'picks',
				type: 'circle',
				source: 'picks',
				paint: {
					'circle-radius': 14,
					'circle-color': '#ffc53d',
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2
				}
			});
			m.addLayer({
				id: 'pick-numbers',
				type: 'symbol',
				source: 'picks',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['Noto Sans Bold'],
					'text-size': 12,
					'text-allow-overlap': true,
					'text-ignore-placement': true
				},
				paint: { 'text-color': '#1c1400' }
			});
			m.addLayer({
				id: 'selected',
				type: 'circle',
				source: 'selected',
				paint: {
					'circle-radius': ['case', ['get', 'pick'], 19, 11],
					'circle-color': 'rgba(0,0,0,0)',
					'circle-stroke-color': '#7dd3fc',
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
			ready = true;
		});

		m.on('click', async (ev) => {
			const { x, y } = ev.point;
			const hits = m.queryRenderedFeatures(
				[
					[x - TAP_RADIUS, y - TAP_RADIUS],
					[x + TAP_RADIUS, y + TAP_RADIUS]
				],
				{ layers: ['clusters', 'others', 'picks'] }
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
			} else {
				planner.select(best.properties.id, 'map');
			}
		});
		for (const layer of ['clusters', 'others', 'picks']) {
			m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
		}

		map = m;
		return () => m.remove();
	});

	// Markers: every pick, plus whatever matches the search and filters unless others are hidden.
	$effect(() => {
		if (!ready || !map) return;
		const picks = planner.picks;
		source('picks').setData(points(planner.events.filter((e) => picks.has(e.id))));
		source('others').setData(
			points(
				planner.hideOthers
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
		for (const [kind, layers] of Object.entries(TRANSIT_LAYERS) as [TransitKind, string[]][]) {
			const visibility = planner.transit[kind] ? 'visible' : 'none';
			for (const layer of layers) map.setLayoutProperty(layer, 'visibility', visibility);
		}
	});

	$effect(() => {
		if (!ready || !map || !popup) return;
		// Its own source, so the ring shows even when the event is hidden or inside a cluster.
		void planner.picks;
		source('selected').setData(points(selected ? [selected] : []));
		if (!selected || !placed(selected)) return void popup.remove();
		const at: [number, number] = [selected.lng, selected.lat];
		if (showPopup) popup.setLngLat(at).addTo(map);
		else popup.remove();
		// A marker tapped near an edge or just above the list: nudge it into the clear.
		const { top, bottom } = padding();
		const y = map.project(at).y;
		if (
			untrack(() => planner.selectedFrom) === 'map' &&
			(y < top || y > container.clientHeight - bottom)
		) {
			map.easeTo({ center: at, padding: padding(), duration: 400 });
		}
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

<div bind:this={container} class="h-full w-full"></div>

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
			<div class="flex"><FavButton id={selected.id} withLabel /></div>
		{/if}
	</div>
</div>
