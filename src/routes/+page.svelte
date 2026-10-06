<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import EventDetail from '#lib/components/EventDetail.svelte';
	import EventList from '#lib/components/EventList.svelte';
	import MapView from '#lib/components/MapView.svelte';
	import { planner, TRANSIT_KINDS } from '#lib/planner.svelte.ts';
	import type { Programme } from '#lib/types.ts';

	const t = $derived(planner.t);

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let mapView = $state<MapView>();
	let transitOpen = $state(false);

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

	// Phone: the list is a sheet pulled up over the map. From 768px it sits beside the map.
	// Peek shows the handle and one row: the All / My picks tabs, or the selected event's card.
	const PEEK = 108;
	let innerWidth = $state(1024);
	let mainHeight = $state(0);
	let dragHeight = $state<number | null>(null);
	let drag: { y: number; height: number; moved: boolean } | null = null;
	let justDragged = false;

	const desktop = $derived(innerWidth >= 768);
	const snaps = $derived({ peek: PEEK, half: Math.round(mainHeight * 0.5), full: mainHeight });
	const sheetHeight = $derived(dragHeight ?? snaps[planner.sheet]);
	const mapInset = $derived(desktop || planner.sheet === 'full' ? 0 : snaps[planner.sheet]);

	function dragStart(e: PointerEvent) {
		drag = { y: e.clientY, height: sheetHeight, moved: false };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function dragMove(e: PointerEvent) {
		if (!drag) return;
		const dy = drag.y - e.clientY;
		if (Math.abs(dy) > 6) drag.moved = true;
		if (drag.moved) dragHeight = Math.min(mainHeight, Math.max(PEEK, drag.height + dy));
	}

	function dragEnd() {
		if (drag?.moved && dragHeight !== null) {
			const h = dragHeight;
			const states = ['peek', 'half', 'full'] as const;
			planner.sheet = states.reduce((a, b) =>
				Math.abs(snaps[b] - h) < Math.abs(snaps[a] - h) ? b : a
			);
			justDragged = true;
		}
		drag = null;
		dragHeight = null;
	}

	function handleTap() {
		// The click that ends a drag is not a tap.
		if (justDragged) return void (justDragged = false);
		planner.sheet = planner.sheet === 'peek' ? 'half' : planner.sheet === 'half' ? 'full' : 'peek';
	}
</script>

<svelte:window bind:innerWidth onhashchange={() => status === 'ready' && planner.readHash()} />

<svelte:head>
	<title>{t.appTitle} 2026</title>
	<meta name="description" content={t.appSubtitle} />
</svelte:head>

{#snippet controls()}
	<div class="flex rounded-xl bg-bg p-1" role="group" aria-label={t.language}>
		{#each ['da', 'en'] as const as lang (lang)}
			<button
				type="button"
				class="tab flex-1 px-3 uppercase"
				aria-pressed={planner.lang === lang}
				onclick={() => planner.setLang(lang)}
			>
				{lang}
			</button>
		{/each}
	</div>
	<button
		type="button"
		class="btn {planner.picks.size ? 'btn-primary' : ''}"
		onclick={() => planner.share()}
	>
		{t.share}
	</button>
{/snippet}

<div class="flex h-dvh flex-col">
	<header class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel pr-2 pl-3">
		<div class="min-w-0 flex-1">
			<h1 class="truncate leading-tight font-bold">{t.appTitle}</h1>
			<p class="truncate text-xs text-muted">
				{t.plannerBy}
				<a class="text-link underline" href="https://luissilva.eu" target="_blank" rel="noopener">
					luissilva.eu
				</a>
			</p>
		</div>
		<div class="hidden items-center gap-2 md:flex">{@render controls()}</div>
		<!-- Phone: sharing is the point of the app, so it stays one tap away; the language switch
		     shrinks to a single button. -->
		<div class="flex items-center gap-1.5 md:hidden">
			<button
				type="button"
				class="btn btn-icon font-bold uppercase"
				aria-label="{t.language}: {planner.lang === 'da' ? 'English' : 'Dansk'}"
				onclick={() => planner.setLang(planner.lang === 'da' ? 'en' : 'da')}
			>
				{planner.lang === 'da' ? 'en' : 'da'}
			</button>
			<button
				type="button"
				class="btn min-h-11 px-3 {planner.picks.size ? 'btn-primary' : ''}"
				onclick={() => planner.share()}
			>
				{t.share}
			</button>
		</div>
	</header>

	{#if status !== 'ready'}
		<p class="m-auto max-w-sm px-6 text-center text-lg text-muted" role="status">
			{status === 'loading' ? t.loading : t.loadError}
		</p>
	{:else}
		<main class="relative min-h-0 flex-1 md:flex" bind:clientHeight={mainHeight}>
			<section
				class="absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl border-t border-line bg-panel shadow-[0_-8px_30px_rgb(0_0_0/0.6)] md:static md:w-[27.5rem] md:shrink-0 md:rounded-none md:border-t-0 md:border-r md:shadow-none
					{dragHeight === null ? 'transition-[height] duration-200' : ''}"
				style:height={desktop ? undefined : `${sheetHeight}px`}
			>
				<button
					type="button"
					class="flex h-11 w-full shrink-0 touch-none items-center justify-center md:hidden"
					aria-label={t.sheetHandle}
					onpointerdown={dragStart}
					onpointermove={dragMove}
					onpointerup={dragEnd}
					onpointercancel={dragEnd}
					onclick={handleTap}
				>
					<span class="h-1.5 w-12 rounded-full bg-muted"></span>
				</button>

				{#if planner.selected}
					<EventDetail event={planner.selected} />
				{/if}
				<!-- Stays mounted under the details so it keeps its scroll position. -->
				<div class="min-h-0 flex-1 flex-col {planner.selected ? 'hidden' : 'flex'}">
					{#if planner.shared}
						<div class="mx-3 mb-2 space-y-2 rounded-xl border border-pick p-3 md:mt-3 md:mb-0">
							<p class="font-semibold">
								{t.sharedTitle(planner.shared.name, planner.shared.picks.length)}
							</p>
							<div class="flex flex-wrap gap-2">
								<button type="button" class="btn btn-primary" onclick={() => planner.saveShared()}>
									{t.sharedSave}
								</button>
								<button type="button" class="link px-2" onclick={() => planner.mergeShared()}>
									{t.sharedMerge(planner.listName(planner.active))}
								</button>
								<button type="button" class="link px-2" onclick={() => planner.dismissShared()}>
									{t.sharedDismiss}
								</button>
							</div>
						</div>
					{/if}

					<EventList />
				</div>
			</section>

			<div class="absolute inset-0 md:relative md:inset-auto md:flex-1">
				<MapView bind:this={mapView} inset={mapInset} popup={desktop} />
				<!-- Below the attribution line, which sits top-left. -->
				<div class="absolute top-9 right-2 flex flex-col gap-2">
					<button
						type="button"
						class="btn btn-icon shadow-lg"
						aria-label={t.locate}
						title={t.locate}
						aria-pressed={planner.me !== null}
						onclick={() => mapView?.locate()}
					>
						<svg
							viewBox="0 0 24 24"
							class="size-6"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="6.5" />
							<circle cx="12" cy="12" r="2" fill="currentColor" />
							<path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
						</svg>
					</button>
					<button
						type="button"
						class="btn btn-icon shadow-lg"
						aria-label={t.fitPicks}
						title={t.fitPicks}
						disabled={planner.picks.size === 0}
						onclick={() => mapView?.fitPicks()}
					>
						<svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
							<path
								d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/>
							<path
								transform="translate(6 5.8) scale(0.5)"
								d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"
								fill="currentColor"
							/>
						</svg>
					</button>
					<button
						type="button"
						class="btn btn-icon shadow-lg"
						aria-label={t.onlyPicks}
						title={t.onlyPicks}
						aria-pressed={planner.hideOthers}
						onclick={() => (planner.hideOthers = !planner.hideOthers)}
					>
						<svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
							<path
								d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"
								fill={planner.hideOthers ? 'currentColor' : 'none'}
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<div class="relative">
						<button
							type="button"
							class="btn btn-icon shadow-lg"
							aria-label={t.transit}
							title={t.transit}
							aria-expanded={transitOpen}
							onclick={() => (transitOpen = !transitOpen)}
						>
							<svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
								<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
								<text
									x="12"
									y="16.2"
									text-anchor="middle"
									font-size="11.5"
									font-weight="800"
									fill="currentColor">M</text
								>
							</svg>
						</button>
						{#if transitOpen}
							<div
								class="absolute top-0 right-full z-10 mr-2 w-56 rounded-xl border border-line bg-raised px-3 py-1 shadow-lg"
							>
								{#each TRANSIT_KINDS as kind (kind)}
									<label class="flex min-h-12 items-center gap-3">
										<input
											type="checkbox"
											class="size-6 accent-pick"
											checked={planner.transit[kind]}
											onchange={(e) => planner.setTransit(kind, e.currentTarget.checked)}
										/>
										{t[kind]}
									</label>
								{/each}
							</div>
						{/if}
					</div>
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
