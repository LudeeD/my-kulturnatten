<script lang="ts">
	import { bikeMinutes, formatDistance, walkMinutes } from '#lib/geo.ts';
	import { placed, planner } from '#lib/planner.svelte.ts';
	import { range, subEventTime } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';
	import FavButton from './FavButton.svelte';

	let { event }: { event: KnEvent } = $props();

	const t = $derived(planner.t);
	const open = $derived(planner.selectedId === event.id);
	const picked = $derived(planner.picks.has(event.id));
	const onward = $derived(open && placed(event) ? planner.onward(event) : null);

	function showOnMap() {
		if (planner.sheet === 'full') planner.sheet = 'peek';
		planner.focusTick++;
	}
</script>

<li id="ev-{event.id}" class="scroll-mt-1 border-b border-line {open ? 'bg-raised' : ''}">
	<div class="flex items-start pr-1">
		<button
			type="button"
			class="flex min-h-16 min-w-0 flex-1 items-start gap-3 py-3 pr-1 pl-3 text-left"
			aria-expanded={open}
			onclick={() => planner.select(open ? null : event.id)}
		>
			<span
				class="mt-0.5 flex h-8 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums
					{picked ? 'bg-pick text-pick-ink' : 'border border-line text-muted'}"
			>
				{event.no || '–'}
			</span>
			<span class="min-w-0 flex-1">
				<span class="block leading-snug font-semibold">{planner.tr(event.title)}</span>
				<span class="block text-sm text-muted">
					{planner.tr(event.organizer)} · {event.area}
				</span>
				<span class="block text-sm text-muted">
					{range(event.start, event.end)}
					{#if event.signupRequired}<span class="text-warn"> · {t.signupRequired}</span>{/if}
					{#if event.amendment}<span class="text-warn"> · {t.amendment}</span>{/if}
				</span>
			</span>
		</button>
		<div class="pt-1.5"><FavButton id={event.id} /></div>
	</div>

	{#if open}
		<div class="space-y-4 px-3 pb-5 text-[0.95rem] leading-relaxed">
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
					<button type="button" class="btn" onclick={showOnMap}>{t.showOnMap}</button>
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
													{formatDistance(metres)} · {t.walk}
													{walkMinutes(metres)} min · {t.bike}
													{bikeMinutes(metres)} min
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
	{/if}
</li>
