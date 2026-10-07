<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import EventDetail from '#lib/components/EventDetail.svelte';
	import EventList from '#lib/components/EventList.svelte';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Chat from '#lib/components/Chat.svelte';
	import MapControls from '#lib/components/MapControls.svelte';
	import MapView from '#lib/components/MapView.svelte';
	import PlanView from '#lib/components/PlanView.svelte';
	import { planner } from '#lib/planner.svelte.ts';
	import type { Programme } from '#lib/types.ts';

	const t = $derived(planner.t);

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let mapView = $state<MapView>();

	onMount(async () => {
		try {
			const res = await fetch(asset('data/events.json'));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			planner.init((await res.json()) as Programme);
			status = 'ready';
		} catch (err) {
			console.error(err);
			status = 'error';
		}
	});

	$effect(() => {
		document.documentElement.lang = planner.lang;
	});

	// The details are open for as long as their history entry is current, so the browser's
	// back button (or swipe) closes them.
	$effect(() => {
		if (!page.state.detail) planner.selectedId = null;
	});

	// Phone: one screen that scrolls, with a small map above the plan; tapping the map makes it
	// fill the screen. From 768px the plan sits beside the map, which is always big.
	let innerWidth = $state(1024);
	let scroller = $state<HTMLDivElement>();
	const desktop = $derived(innerWidth >= 768);
	const big = $derived(desktop || planner.bigMap);
	// Over the big map on a phone, an event tapped on the map only gets the map's own card.
	const detail = $derived(
		planner.selected && (!big || desktop || planner.selectedFrom === 'list')
			? planner.selected
			: null
	);

	function closeMap() {
		planner.bigMap = false;
		if (planner.selectedId !== null) planner.close();
	}
</script>

<svelte:window
	onpagehide={() => planner.leave()}
	bind:innerWidth
	onhashchange={() => status === 'ready' && planner.readHash()}
/>

<svelte:head>
	<title>{planner.planName ? `${planner.planName} · ` : ''}{t.appTitle} 2026</title>
	<meta name="description" content={t.appSubtitle} />
</svelte:head>

<div class="flex h-dvh flex-col">
	<AppHeader />

	{#if status !== 'ready'}
		<p class="m-auto max-w-sm px-6 text-center text-lg text-muted" role="status">
			{status === 'loading' ? t.loading : t.loadError}
		</p>
	{:else}
		<main class="relative min-h-0 flex-1">
			<div class="flex h-full flex-col md:w-[27.5rem] md:border-r md:border-line">
				<div class="relative min-h-0 flex-1">
					<div bind:this={scroller} class="h-full overflow-y-auto overscroll-contain pb-20">
						<!-- The map's place in the plan on a phone. -->
						<div class="relative mx-3 mt-3 h-48 md:static md:m-0 md:h-0">
							<div
								class="{planner.bigMap
									? 'fixed inset-x-0 top-16 bottom-0 z-20'
									: 'relative isolate h-full overflow-hidden rounded-2xl border border-line'}
								md:fixed md:inset-auto md:top-16 md:right-0 md:bottom-0 md:left-[27.5rem] md:z-0 md:h-auto md:rounded-none md:border-0"
							>
								<MapView bind:this={mapView} small={!big} popup={big} />
								{#if !big}
									<button
										type="button"
										class="absolute inset-0 rounded-2xl"
										aria-label={t.openMap}
										onclick={() => (planner.bigMap = true)}
									>
										<!-- Says the map opens: the whole of it is the button. -->
										<span
											class="absolute right-2 bottom-2 flex size-9 items-center justify-center rounded-full border border-line bg-raised shadow-lg"
										>
											<svg
												viewBox="0 0 24 24"
												class="size-5"
												fill="none"
												stroke="currentColor"
												stroke-width="2.2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
											>
												<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
											</svg>
										</span>
									</button>
								{:else}
									<MapControls
										locate={() => mapView?.locate()}
										fit={() => mapView?.fitPicks()}
										back={closeMap}
									/>
								{/if}
							</div>
							{#if !big}
								<!-- Rounds the small map from on top: a frame in the page's colour over its
								     corners. Clipping the map from its parent is not honoured by every browser
								     for a WebGL canvas. -->
								<span
									class="pointer-events-none absolute inset-0 rounded-2xl border border-line shadow-[0_0_0_5px_var(--color-bg)]"
								></span>
							{/if}
						</div>
						{#if scroller}<PlanView {scroller} />{/if}
					</div>

					<!-- By the thumb, like the map's buttons. Only a shared plan has a chat. -->
					{#if planner.shared}
						<button
							type="button"
							class="btn btn-icon absolute right-4 bottom-6 rounded-full shadow-lg"
							aria-label={t.chat}
							title={t.chat}
							onclick={() => planner.openChat()}
						>
							<svg
								viewBox="0 0 24 24"
								class="size-6"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 5h16v11H9l-5 4z" />
							</svg>
							{#if planner.unread}
								<span
									class="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-warn ring-2 ring-bg"
								></span>
							{/if}
						</button>
					{/if}

					<!-- Stays mounted, so it keeps its search and its scroll position. -->
					<div
						class="absolute inset-0 z-10 flex-col bg-bg {planner.view === 'all'
							? 'flex'
							: 'hidden'}"
					>
						<EventList />
					</div>
					{#if planner.chatOpen}
						<div class="absolute inset-0 z-30 flex flex-col bg-bg"><Chat /></div>
					{/if}
					{#if detail}
						<div class="absolute inset-0 z-30 flex flex-col bg-bg">
							<EventDetail event={detail} />
						</div>
					{/if}
				</div>
			</div>
		</main>
	{/if}

	{#if planner.toast}
		<div
			class="fixed top-16 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-fg py-2 pr-2 pl-4 font-semibold text-bg shadow-lg"
			role="status"
		>
			<span class="py-1 pr-2">{planner.toast.text}</span>
			{#if planner.toast.action}
				{@const action = planner.toast.action}
				<button
					type="button"
					class="min-h-10 shrink-0 rounded-full bg-bg px-4 text-fg"
					onclick={() => {
						// Take the callback first: clearing the toast also clears `action`.
						const run = action.run;
						planner.toast = null;
						run();
					}}
				>
					{action.label}
				</button>
			{/if}
		</div>
	{/if}
</div>
