<script lang="ts">
	import { travel } from '#lib/geo.ts';
	import { placed, planner } from '#lib/planner.svelte.ts';
	import { range, subEventTime } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';
	import FavButton from './FavButton.svelte';

	let { event }: { event: KnEvent } = $props();

	const t = $derived(planner.t);
	const picked = $derived(planner.picks.has(event.id));
	const onward = $derived(placed(event) ? planner.onward(event) : null);
	const fromMe = $derived(planner.metresFromMe(event));

	function showOnMap() {
		if (planner.sheet === 'full') planner.sheet = 'peek';
		planner.focusTick++;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!-- On a phone this header is all that shows when the sheet is down: the card for the marker. -->
	<div class="flex min-h-16 shrink-0 items-start gap-1 border-b border-line pr-1 pb-2 pl-1 md:pt-2">
		<button
			type="button"
			class="flex size-12 shrink-0 items-center justify-center rounded-xl"
			aria-label={t.back}
			onclick={() => planner.close()}
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
		<div class="min-w-0 flex-1 pt-1">
			<h2 class="leading-snug font-semibold">
				{#if event.no}
					<span class="tabular-nums {picked ? 'text-pick' : 'text-muted'}">{event.no}</span>
				{/if}
				{planner.tr(event.title)}
			</h2>
			<p class="truncate text-sm text-muted">
				{planner.tr(event.organizer)} · {range(event.start, event.end)}
			</p>
		</div>
		<FavButton id={event.id} />
	</div>

	{#key event.id}
		<div
			class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pt-3 pb-6 text-[0.95rem] leading-relaxed"
		>
			{#if event.amendment}
				<p class="rounded-xl border border-warn px-3 py-2 text-warn">
					<strong>{t.amendment}:</strong>
					{event.amendment}
				</p>
			{/if}

			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt class="text-muted">{t.openingHours}</dt>
				<dd class="font-semibold">{range(event.start, event.end)}</dd>
				<dt class="text-muted">{t.address}</dt>
				<dd>{event.address}, {event.zip} {event.city}</dd>
				{#if fromMe !== null}
					<dt class="text-muted">{t.fromYou}</dt>
					<dd>{travel(fromMe, t)}</dd>
				{/if}
				{#if event.audience.length}
					<dt class="text-muted">{t.audience}</dt>
					<dd>{event.audience.map((a) => planner.label(a)).join(', ')}</dd>
				{/if}
			</dl>

			{#if event.types.length || event.practical.length}
				<ul class="flex flex-wrap gap-1.5 text-sm">
					{#each event.types as type (type)}
						<li class="rounded-full border border-line px-2.5 py-0.5">{planner.label(type)}</li>
					{/each}
					{#each event.practical as item (item)}
						<li class="rounded-full border border-line px-2.5 py-0.5 text-muted">
							{planner.label(item)}
						</li>
					{/each}
				</ul>
			{/if}

			{#if event.signupRequired}
				<div class="rounded-xl border border-warn px-3 py-2">
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

			<p class="whitespace-pre-line">{planner.tr(event.description)}</p>

			{#if event.subEvents.length}
				<section>
					<h3 class="mb-2 text-sm font-bold tracking-wide text-muted uppercase">{t.programme}</h3>
					<ul class="space-y-3">
						{#each event.subEvents as sub, i (i)}
							<li class="border-l-2 border-pick pl-3">
								<p class="font-semibold text-pick tabular-nums">
									{subEventTime(sub, t)}
								</p>
								<p class="font-semibold">{planner.tr(sub.title)}</p>
								{#if planner.tr(sub.description)}
									<p class="whitespace-pre-line text-muted">{planner.tr(sub.description)}</p>
								{/if}
								<p class="text-sm text-muted">
									{[sub.childFriendly && t.childFriendly, sub.accessible && t.accessible]
										.filter(Boolean)
										.join(' · ')}
								</p>
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

			<div class="flex flex-wrap gap-2">
				{#if event.website}
					<a class="btn" href={event.website} target="_blank" rel="noopener noreferrer">
						{t.website} &rarr;
					</a>
				{/if}
				{#if event.itineraryUrl}
					<a class="btn" href={event.itineraryUrl} target="_blank" rel="noopener noreferrer">
						{t.itinerary} &rarr;
					</a>
				{/if}
				{#if placed(event)}
					<button type="button" class="btn md:hidden" onclick={showOnMap}>{t.showOnMap}</button>
				{/if}
			</div>
			{#if !placed(event)}<p class="text-sm text-muted">{t.noPosition}</p>{/if}

			{#if onward}
				<section>
					<h3 class="text-sm font-bold tracking-wide text-muted uppercase">{t.onward}</h3>
					<p class="mb-1 text-sm text-muted">{t.estimateNote}</p>
					{#each [{ title: t.otherPicks, items: onward.picks, pick: true }, { title: t.nearby, items: onward.nearby, pick: false }] as group (group.title)}
						{#if group.items.length}
							<h4 class="mt-3 text-sm font-semibold text-muted">{group.title}</h4>
							<ul>
								{#each group.items as { event: next, metres } (next.id)}
									<li>
										<button
											type="button"
											class="flex min-h-14 w-full items-center gap-3 border-b border-line py-2 text-left"
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
						{/if}
					{/each}
				</section>
			{/if}
		</div>
	{/key}
</div>
