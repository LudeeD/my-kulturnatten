<script lang="ts">
	import { untrack } from 'svelte';
	import { planner } from '#lib/planner.svelte.ts';
	import EventCard from './EventCard.svelte';

	const t = $derived(planner.t);
	let filtersOpen = $state(false);

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

	// Keep the open card in view: at the top when it was chosen on the map, otherwise just visible.
	$effect(() => {
		const id = planner.selectedId;
		void planner.scrollTick;
		if (id === null) return;
		const fromMap = untrack(() => planner.selectedFrom) === 'map';
		document
			.getElementById(`ev-${id}`)
			?.scrollIntoView({ block: fromMap ? 'start' : 'nearest', behavior: 'smooth' });
	});

	function raiseSheet() {
		if (planner.sheet === 'peek') planner.sheet = 'full';
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="space-y-2 px-3 pb-2 md:pt-3">
		<div class="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1" role="group">
			<button
				type="button"
				class="tab"
				aria-pressed={!planner.picksOnly}
				onclick={() => (planner.picksOnly = false)}
			>
				{t.all} <span class="tabular-nums opacity-70">{planner.events.length}</span>
			</button>
			<button
				type="button"
				class="tab"
				aria-pressed={planner.picksOnly}
				onclick={() => (planner.picksOnly = true)}
			>
				★ {planner.shared ? t.sharedPlan : t.myPicks}
				<span class="tabular-nums opacity-70">{planner.picks.size}</span>
			</button>
		</div>

		<div class="flex gap-2">
			<input
				type="search"
				class="field min-w-0 flex-1"
				placeholder={t.search}
				aria-label={t.search}
				bind:value={planner.query}
				onfocus={raiseSheet}
			/>
			<button
				type="button"
				class="btn shrink-0"
				aria-expanded={filtersOpen}
				onclick={() => {
					filtersOpen = !filtersOpen;
					raiseSheet();
				}}
			>
				{t.filters}{#if planner.activeFilters}
					<span class="ml-1 rounded-full bg-pick px-1.5 text-sm font-bold text-pick-ink">
						{planner.activeFilters}
					</span>
				{/if}
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
					<label class="flex min-h-12 items-center gap-3">
						<input type="checkbox" class="size-6 accent-pick" bind:checked={planner.childOnly} />
						{t.childFriendly}
					</label>
					{#if planner.activeFilters || planner.query}
						<button type="button" class="link min-h-12" onclick={() => planner.clearFilters()}>
							{t.clearFilters}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<p class="text-sm text-muted" aria-live="polite">{t.events(planner.filtered.length)}</p>
	</div>

	<ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
		{#each planner.filtered as event (event.id)}
			<EventCard {event} />
		{:else}
			<li class="px-4 py-8 text-center text-muted">
				{planner.picksOnly && planner.picks.size === 0 ? t.noPicks : t.noResults}
			</li>
		{/each}
		<li class="px-4 py-6 text-center text-sm text-muted">
			{t.dataNote}
			{fetched}.<br />{t.unofficial}
		</li>
	</ul>
</div>
