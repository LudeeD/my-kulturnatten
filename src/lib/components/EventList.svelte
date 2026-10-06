<script lang="ts">
	import { planner } from '#lib/planner.svelte.ts';
	import EventCard from './EventCard.svelte';

	const t = $derived(planner.t);
	const arrival = $derived(planner.arrival);
	let filtersOpen = $state(false);
	let listMenuOpen = $state(false);
	/** The list name being typed, for a new list or a rename. */
	let editing = $state<'new' | 'rename' | null>(null);
	let draft = $state('');

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

	function startEditing(mode: 'new' | 'rename') {
		listMenuOpen = false;
		draft = mode === 'rename' ? planner.listName(planner.active) : '';
		editing = mode;
	}

	function saveName(e: SubmitEvent) {
		e.preventDefault();
		if (!draft.trim()) return;
		if (editing === 'new') planner.newList(draft);
		else planner.renameActive(draft);
		editing = null;
	}

	function raiseSheet() {
		if (planner.sheet === 'peek') planner.sheet = 'full';
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!-- First visit. Above everything else so it fits in the half-open sheet on a phone. -->
	{#if planner.showHint}
		<div
			class="mx-3 mb-3 shrink-0 rounded-xl border border-pick p-3 text-[0.95rem] md:mt-3 md:mb-0"
		>
			<h2 class="font-bold">{arrival ? t.arrivalTitle(arrival.name) : t.welcomeTitle}</h2>
			<ol class="mt-2 space-y-1.5">
				{#each arrival ? t.arrivalSteps(arrival.count) : t.welcomeSteps as step, i (i)}
					<li class="flex gap-3">
						<span
							class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-pick text-sm font-bold text-pick-ink"
						>
							{i + 1}
						</span>
						<span>{step}</span>
					</li>
				{/each}
			</ol>
			<button
				type="button"
				class="btn btn-primary mt-3 w-full"
				onclick={() => planner.dismissHint()}
			>
				{t.gotIt}
			</button>
		</div>
	{/if}
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
				class="tab flex min-w-0 items-center justify-center gap-1.5 px-2"
				aria-pressed={planner.picksOnly}
				onclick={() => (planner.picksOnly = true)}
			>
				<span class="truncate">
					★ {planner.shared ? t.sharedList : t.myLists}
				</span>
				<span class="tabular-nums opacity-70">{planner.picks.size}</span>
			</button>
		</div>

		{#if planner.picksOnly && !planner.shared}
			{#if editing}
				<form class="flex gap-1.5 [&>.btn]:px-3" onsubmit={saveName}>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="field min-w-0 flex-1"
						aria-label={t.listName}
						placeholder={t.listName}
						maxlength="40"
						autofocus
						bind:value={draft}
					/>
					<button type="submit" class="btn btn-primary">{t.save}</button>
					<button type="button" class="btn" onclick={() => (editing = null)}>{t.cancel}</button>
				</form>
			{:else}
				<div class="relative flex gap-1.5">
					<select
						class="field min-w-0 flex-1"
						aria-label={t.lists}
						value={planner.activeId}
						onchange={(e) => planner.setActive(e.currentTarget.value)}
					>
						{#each planner.lists as list (list.id)}
							<option value={list.id}>{planner.listName(list)} ({list.picks.length})</option>
						{/each}
					</select>
					<button
						type="button"
						class="btn w-12 px-0"
						aria-label={t.listOptions}
						aria-expanded={listMenuOpen}
						onclick={() => (listMenuOpen = !listMenuOpen)}
					>
						<svg viewBox="0 0 24 24" class="size-6" fill="currentColor" aria-hidden="true">
							<circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" />
							<circle cx="19" cy="12" r="2" />
						</svg>
					</button>
					{#if listMenuOpen}
						<div
							class="absolute top-full right-0 z-10 mt-1.5 w-52 rounded-xl border border-line bg-raised p-1 shadow-lg"
						>
							<button type="button" class="menu-item" onclick={() => startEditing('new')}>
								{t.newList}
							</button>
							<button type="button" class="menu-item" onclick={() => startEditing('rename')}>
								{t.renameList}
							</button>
							<button
								type="button"
								class="menu-item text-warn"
								onclick={() => {
									listMenuOpen = false;
									planner.deleteActive();
								}}
							>
								{t.deleteList}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{/if}

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
