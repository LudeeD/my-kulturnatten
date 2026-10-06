<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import EventList from '#lib/components/EventList.svelte';
	import MapView from '#lib/components/MapView.svelte';
	import { planner, TRANSIT_KINDS } from '#lib/planner.svelte.ts';
	import type { Programme } from '#lib/types.ts';

	const t = $derived(planner.t);

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let mapView = $state<MapView>();
	let toast = $state('');
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

	// Phone: the list is a sheet pulled up over the map. From 768px it sits beside the map.
	// Peek shows the handle and the All / My picks tabs.
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

	async function share() {
		const url = location.href;
		const title = t.appTitle;
		if (!desktop && navigator.share) {
			// Rejects when the user closes the share sheet; nothing to do then.
			await navigator.share({ title, url }).catch(() => {});
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			toast = t.linkCopied;
			setTimeout(() => (toast = ''), 2500);
		} catch {
			window.prompt(t.copyLink, url);
		}
	}
</script>

<svelte:window bind:innerWidth onhashchange={() => status === 'ready' && planner.readHash()} />

<svelte:head>
	<title>{t.appTitle} 2026</title>
	<meta name="description" content={t.appSubtitle} />
</svelte:head>

<div class="flex h-dvh flex-col">
	{#snippet subtitle()}
		{t.plannerBy}
		<a class="text-link underline" href="https://luissilva.eu" target="_blank" rel="noopener">
			luissilva.eu
		</a>
		· {t.when}
	{/snippet}

	<!-- Phone: the subtitle gets its own row, or the name it credits is cut off. -->
	<header
		class="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 border-b border-line bg-panel pt-1 pr-2 pl-3 md:pt-0"
	>
		<div class="min-w-0 flex-1">
			<h1 class="truncate leading-tight font-bold">{t.appTitle}</h1>
			<p class="hidden truncate text-xs text-muted md:block">{@render subtitle()}</p>
		</div>
		<div class="flex rounded-xl bg-bg p-1" role="group" aria-label={t.language}>
			{#each ['da', 'en'] as const as lang (lang)}
				<button
					type="button"
					class="tab w-11 uppercase"
					aria-pressed={planner.lang === lang}
					onclick={() => planner.setLang(lang)}
				>
					{lang}
				</button>
			{/each}
		</div>
		<button type="button" class="btn" onclick={share}>{t.share}</button>
		<p class="w-full truncate py-1 text-xs text-muted md:hidden">{@render subtitle()}</p>
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

				{#if planner.shared}
					<div class="mx-3 mb-2 space-y-2 rounded-xl border border-pick p-3 md:mt-3 md:mb-0">
						<p class="font-semibold">{t.sharedTitle(planner.shared.length)}</p>
						<div class="flex flex-wrap gap-2">
							<button type="button" class="btn" onclick={() => planner.mergeShared()}>
								{t.sharedMerge}
							</button>
							<button type="button" class="btn" onclick={() => planner.replaceWithShared()}>
								{t.sharedReplace}
							</button>
							<button type="button" class="btn" onclick={() => planner.dismissShared()}>
								{t.sharedDismiss}
							</button>
						</div>
					</div>
				{/if}

				<EventList />
			</section>

			<div class="absolute inset-0 md:relative md:inset-auto md:flex-1">
				<MapView bind:this={mapView} inset={mapInset} />
				<!-- Below the attribution line, which sits top-left. -->
				<div
					class="absolute top-9 right-2 left-2 flex flex-wrap justify-end gap-1.5 max-md:text-sm [&>.btn]:px-2.5"
				>
					<button
						type="button"
						class="btn shadow-lg"
						disabled={planner.picks.size === 0}
						onclick={() => mapView?.fitPicks()}
					>
						★ {t.fitPicks}
					</button>
					<button
						type="button"
						class="btn shadow-lg"
						aria-pressed={planner.hideOthers}
						onclick={() => (planner.hideOthers = !planner.hideOthers)}
					>
						{t.onlyPicks}
					</button>
					<div class="relative">
						<button
							type="button"
							class="btn px-2.5 shadow-lg"
							aria-expanded={transitOpen}
							onclick={() => (transitOpen = !transitOpen)}
						>
							{t.transit}
							<span class="ml-1.5 hidden text-muted tabular-nums md:inline">
								{TRANSIT_KINDS.filter((kind) => planner.transit[kind])
									.length}/{TRANSIT_KINDS.length}
							</span>
						</button>
						{#if transitOpen}
							<div
								class="absolute top-full right-0 z-10 mt-1.5 w-56 rounded-xl border border-line bg-raised px-3 py-1 shadow-lg"
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

	{#if toast}
		<p
			class="fixed top-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-fg px-4 py-2 font-semibold text-bg"
			role="status"
		>
			{toast}
		</p>
	{/if}
</div>
