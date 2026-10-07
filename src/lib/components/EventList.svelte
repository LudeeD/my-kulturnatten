<script lang="ts">
	import { planner } from '#lib/planner.svelte.ts';
	import EventCard from './EventCard.svelte';

	const t = $derived(planner.t);
	let filtersOpen = $state(false);

	function showMap() {
		// The map shows what the search and filters leave, to be added from there.
		planner.hideOthers = false;
		planner.bigMap = true;
	}

	const collator = new Intl.Collator('da');
	const areas = $derived([...new Set(planner.events.map((e) => e.area))].sort(collator.compare));
	const types = $derived(
		[...new Set(planner.events.flatMap((e) => e.types))].sort(collator.compare)
	);

	const fetched = $derived(
		planner.fetchedAt
			? new Date(planner.fetchedAt).toLocaleString(planner.lang === 'da' ? 'da-DK' : 'en-GB', {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: ''
	);

	// Coming back from an event's details: make sure that event is in view.
	let lastOpened: number | null = null;
	$effect(() => {
		const id = planner.selectedId;
		if (id === null && lastOpened !== null) {
			document.getElementById(`ev-${lastOpened}`)?.scrollIntoView({ block: 'nearest' });
		}
		lastOpened = id;
	});
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="space-y-2 px-3 pt-3 pb-2">
		<div class="flex gap-2">
			<button
				type="button"
				class="btn btn-icon shrink-0"
				aria-label="{t.back}: {t.plan}"
				onclick={() => (planner.view = 'plan')}
			>
				<svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
					<path
						d="M15 5l-7 7 7 7"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<input
				type="search"
				class="field min-w-0 flex-1"
				placeholder={t.search}
				aria-label={t.search}
				bind:value={planner.query}
			/>
			<button
				type="button"
				class="btn shrink-0"
				aria-expanded={filtersOpen}
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				{t.filters}{#if planner.activeFilters}
					<span class="ml-1 rounded-full bg-pick px-1.5 text-sm font-bold text-pick-ink">
						{planner.activeFilters}
					</span>
				{/if}
			</button>
			<!-- Phone: places can be picked from the map as well. From 768px it is already beside the list. -->
			<button
				type="button"
				class="btn btn-icon shrink-0 md:hidden"
				aria-label={t.openMap}
				title={t.openMap}
				onclick={showMap}
			>
				<svg
					viewBox="0 0 24 24"
					class="size-6"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
					<path d="M9 4v13.5M15 6.5V20" />
				</svg>
			</button>
		</div>

		{#if filtersOpen}
			<div class="space-y-2">
				<select class="field w-full" aria-label={t.area} bind:value={planner.area}>
					<option value="">{t.allAreas}</option>
					{#each areas as area (area)}<option value={area}>{area}</option>{/each}
				</select>
				<select class="field w-full" aria-label={t.type} bind:value={planner.type}>
					<option value="">{t.allTypes}</option>
					{#each types as type (type)}<option value={type}>{planner.label(type)}</option>{/each}
				</select>
				<div class="flex items-center justify-between gap-2">
					<label class="flex min-h-10 items-center gap-3">
						<input type="checkbox" class="size-6 accent-pick" bind:checked={planner.childOnly} />
						{t.childFriendly}
					</label>
					{#if planner.activeFilters || planner.query}
						<button type="button" class="link" onclick={() => planner.clearFilters()}>
							{t.clearFilters}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<div class="flex min-h-6 items-center justify-between gap-2">
			<p class="text-sm text-muted" aria-live="polite">{t.events(planner.filtered.length)}</p>
			{#if planner.me}
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" class="size-5 accent-pick" bind:checked={planner.nearMe} />
					{t.nearMe}
				</label>
			{/if}
		</div>
	</div>

	<ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
		{#each planner.filtered as event (event.id)}
			<EventCard {event} />
		{:else}
			<li class="px-4 py-8 text-center text-muted">{t.noResults}</li>
		{/each}
		<li class="px-4 py-6 text-center text-sm text-muted">
			{t.dataNote}
			{fetched}.<br />{t.unofficial}
		</li>
	</ul>
</div>
