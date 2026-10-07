<script lang="ts">
	import { travel } from '#lib/geo.ts';
	import { shortName } from '#lib/plan.ts';
	import { placed, planner, type Place } from '#lib/planner.svelte.ts';
	import { clock } from '#lib/time.ts';

	let { place }: { place: Place } = $props();

	const t = $derived(planner.t);
	const event = $derived(place.event);
	const nearest = $derived(placed(event) ? planner.nearestPlace(event) : null);
	const messages = $derived(planner.messages.filter((m) => m.place === event.id).length);

	let confirming = $state(false);
</script>

<div class="mt-2 space-y-2 rounded-xl bg-raised p-3">
	<div class="flex items-start justify-between gap-3">
		<h3 class="leading-snug font-semibold">{planner.tr(event.organizer)}</h3>
		<button
			type="button"
			class="link min-h-0 shrink-0 text-sm text-muted"
			onclick={() => (planner.openPlaceId = null)}
		>
			{t.close}
		</button>
	</div>
	<p class="truncate text-sm text-muted">{planner.tr(event.title)}</p>
	<!-- Every event opens at 18:00, so only the closing time says anything. -->
	<p class="text-sm font-semibold tabular-nums">
		{event.area} · {t.until}
		{clock(event.end)}{#if event.subEvents.length}
			· {t.sessions(event.subEvents.length)}{/if}
	</p>
	{#if event.signupRequired}
		<p class="text-sm font-semibold text-warn">{t.signupRequired}</p>
	{/if}
	{#if nearest}
		<p class="text-sm text-muted tabular-nums">
			{t.nearest(shortName(planner.tr(nearest.event.organizer)))} · {travel(nearest.metres, t)}
		</p>
	{/if}

	<!-- Talking about a place happens in the plan's chat, which only a shared plan has. -->
	{#if planner.shared}
		<button type="button" class="link text-sm" onclick={() => planner.openChat(event.id)}>
			{messages ? t.messagesAbout(messages) : t.sayAbout}
		</button>
	{/if}

	<div class="flex items-center justify-between gap-3 border-t border-line pt-1 text-sm text-muted">
		<span class="min-w-0 truncate">{t.putHereBy(planner.nameOf(place.movedBy))}</span>
		<span class="flex shrink-0 items-center gap-3">
			{#if confirming}
				<span>
					{t.removeForEveryone}
					<button
						type="button"
						class="link ml-1 text-sm text-warn"
						onclick={() => planner.removePlace(event.id)}
					>
						{t.yesRemove}
					</button>
				</span>
			{:else}
				<button type="button" class="link text-sm" onclick={() => planner.select(event.id)}>
					{t.details}
				</button>
				<button type="button" class="link text-sm text-muted" onclick={() => (confirming = true)}>
					{t.remove}
				</button>
			{/if}
		</span>
	</div>
</div>
