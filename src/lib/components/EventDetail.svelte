<script lang="ts">
	import { travel } from '#lib/geo.ts';
	import { placed, planner } from '#lib/planner.svelte.ts';
	import { range, subEventTime } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';

	let { event }: { event: KnEvent } = $props();

	const t = $derived(planner.t);
	const picked = $derived(planner.picks.has(event.id));
	const onward = $derived(placed(event) ? planner.onward(event) : null);
	const fromMe = $derived(planner.metresFromMe(event));
	let nearby = $state<HTMLDivElement>();

	function showOnMap() {
		planner.bigMap = true;
		// The map shows its own card for the event; the details step aside.
		planner.selectedFrom = 'map';
		planner.focusTick++;
	}
</script>

{#snippet star(filled: boolean)}
	<svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
		<path
			d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"
			fill={filled ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linejoin="round"
		/>
	</svg>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex min-h-16 shrink-0 items-center gap-1 border-b border-line pr-3 pl-1">
		<button
			type="button"
			class="flex size-12 shrink-0 items-center justify-center rounded-xl"
			aria-label={t.back}
			onclick={() => planner.closeDetails()}
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
		<p class="min-w-0 flex-1 truncate font-semibold">{planner.tr(event.organizer)}</p>
	</div>

	{#key event.id}
		<div
			class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pt-4 pb-8 text-[0.95rem] leading-relaxed"
		>
			<header class="space-y-2">
				<p class="flex items-center gap-2 text-sm text-muted">
					{#if event.no}
						<span
							class="rounded-full px-2.5 py-0.5 font-bold tabular-nums
								{picked ? 'bg-pick text-pick-ink' : 'border border-line'}"
						>
							{event.no}
						</span>
					{/if}
					<span class="truncate">{event.area}</span>
				</p>
				<h2 class="text-xl leading-snug font-bold">{planner.tr(event.title)}</h2>
				<!-- The star, spelled out: this is where an event gets into the plan. -->
				<button
					type="button"
					class="btn w-full gap-2 rounded-full {picked ? '' : 'btn-primary'}"
					onclick={() => planner.toggle(event.id)}
				>
					{@render star(picked)}
					{picked ? t.picked : t.pick}
				</button>
			</header>

			{#if event.amendment}
				<p class="rounded-2xl border-[1.5px] border-warn bg-raised px-3 py-2 text-warn">
					<strong>{t.amendment}:</strong>
					{event.amendment}
				</p>
			{/if}

			{#if event.signupRequired}
				<div class="rounded-2xl border-[1.5px] border-warn bg-raised px-3 py-2">
					<p class="font-semibold text-warn">{t.signupRequired}</p>
					{#if event.signupUrl}
						<a class="link" href={event.signupUrl} target="_blank" rel="noopener noreferrer">
							{t.signup} &rarr;
						</a>
					{:else}
						<p class="text-muted">{t.signupNoLink}</p>
					{/if}
				</div>
			{/if}

			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-raised p-3">
				<dt class="text-muted">{t.openingHours}</dt>
				<dd class="font-semibold tabular-nums">{range(event.start, event.end)}</dd>
				<dt class="text-muted">{t.address}</dt>
				<dd>{event.address}, {event.zip} {event.city}</dd>
				{#if fromMe !== null}
					<dt class="text-muted">{t.fromYou}</dt>
					<dd class="tabular-nums">{travel(fromMe, t)}</dd>
				{/if}
				{#if event.audience.length}
					<dt class="text-muted">{t.audience}</dt>
					<dd>{event.audience.map((a) => planner.label(a)).join(', ')}</dd>
				{/if}
			</dl>

			<div class="flex flex-wrap gap-2">
				{#if placed(event)}
					<button type="button" class="btn rounded-full md:hidden" onclick={showOnMap}>
						{t.showOnMap}
					</button>
				{/if}
				{#if onward}
					<!-- The list is at the very bottom, past a description nobody may scroll through. -->
					<button
						type="button"
						class="btn rounded-full"
						onclick={() => nearby?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
					>
						{t.seeNearby} &darr;
					</button>
				{/if}
				{#if event.website}
					<a
						class="btn rounded-full"
						href={event.website}
						target="_blank"
						rel="noopener noreferrer"
					>
						{t.website} &rarr;
					</a>
				{/if}
				{#if event.itineraryUrl}
					<a
						class="btn rounded-full"
						href={event.itineraryUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						{t.itinerary} &rarr;
					</a>
				{/if}
			</div>
			{#if !placed(event)}<p class="text-sm text-muted">{t.noPosition}</p>{/if}

			<p class="whitespace-pre-line">{planner.tr(event.description)}</p>

			{#if event.types.length || event.practical.length}
				<ul class="flex flex-wrap gap-1.5 text-sm">
					{#each event.types as type (type)}
						<li class="rounded-full border border-line bg-raised px-2.5 py-0.5 font-semibold">
							{planner.label(type)}
						</li>
					{/each}
					{#each event.practical as item (item)}
						<li class="rounded-full border border-line px-2.5 py-0.5 text-muted">
							{planner.label(item)}
						</li>
					{/each}
				</ul>
			{/if}

			{#if event.subEvents.length}
				<section class="space-y-2">
					<h3 class="text-sm font-semibold text-muted">{t.programme}</h3>
					<ul class="space-y-2">
						{#each event.subEvents as sub, i (i)}
							<li class="space-y-1 rounded-2xl bg-raised p-3">
								<p
									class="inline-block rounded-full bg-pick px-2.5 py-0.5 text-sm font-bold text-pick-ink tabular-nums"
								>
									{subEventTime(sub, t)}
								</p>
								<p class="font-semibold">{planner.tr(sub.title)}</p>
								{#if planner.tr(sub.description)}
									<p class="whitespace-pre-line text-muted">{planner.tr(sub.description)}</p>
								{/if}
								{#if sub.childFriendly || sub.accessible}
									<p class="text-sm text-muted">
										{[sub.childFriendly && t.childFriendly, sub.accessible && t.accessible]
											.filter(Boolean)
											.join(' · ')}
									</p>
								{/if}
								{#if sub.signupUrl}
									<a class="link" href={sub.signupUrl} target="_blank" rel="noopener noreferrer">
										{t.signup} &rarr;
									</a>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if onward}
				<div bind:this={nearby} class="-mb-4"></div>
				{#each [{ title: t.otherPicks, items: onward.picks, pick: true }, { title: t.nearby, items: onward.nearby, pick: false }] as group (group.title)}
					{#if group.items.length}
						<section class="space-y-2">
							<h3 class="text-sm font-semibold text-muted">{group.title}</h3>
							<ul class="divide-y divide-line rounded-2xl bg-raised px-3">
								{#each group.items as { event: next, metres } (next.id)}
									<li>
										<button
											type="button"
											class="flex min-h-14 w-full items-center gap-3 py-2 text-left"
											onclick={() => planner.select(next.id)}
										>
											<span
												class="flex h-7 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums
													{group.pick ? 'bg-pick text-pick-ink' : 'border border-line text-muted'}"
											>
												{next.no || '–'}
											</span>
											<span class="min-w-0 flex-1">
												<span class="block truncate font-semibold">{planner.tr(next.title)}</span>
												<span class="block text-sm text-muted tabular-nums">
													{travel(metres, t)}
												</span>
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				{/each}
				<p class="text-sm text-muted">{t.estimateNote}</p>
			{/if}
		</div>
	{/key}
</div>
