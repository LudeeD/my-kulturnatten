<script lang="ts">
	import { formatDistance } from '#lib/geo.ts';
	import { planner } from '#lib/planner.svelte.ts';
	import { clock, range } from '#lib/time.ts';
	import type { KnEvent } from '#lib/types.ts';
	import FavButton from './FavButton.svelte';

	let { event }: { event: KnEvent } = $props();

	const t = $derived(planner.t);
	const picked = $derived(planner.picks.has(event.id));
	const timed = $derived(event.subEvents.some((s) => s.slots.length > 0 || s.start > 0));
	const metres = $derived(planner.nearMe ? planner.metresFromMe(event) : null);
</script>

<li id="ev-{event.id}" class="flex items-start border-b border-line pr-1">
	<button
		type="button"
		class="flex min-h-16 min-w-0 flex-1 items-start gap-3 py-3 pr-1 pl-3 text-left"
		onclick={() => planner.select(event.id)}
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
			<!-- Every event opens at 18:00, so only the closing time says anything. -->
			<span class="block text-sm text-muted">
				{#if metres !== null}<span class="text-fg">{formatDistance(metres)}</span> ·{/if}
				{event.start > 0 ? range(event.start, event.end) : `${t.until} ${clock(event.end)}`}
				{#if timed}
					· {t.timed}{/if}
				{#if event.signupRequired}<span class="text-warn"> · {t.signupRequired}</span>{/if}
				{#if event.amendment}<span class="text-warn"> · {t.amendment}</span>{/if}
			</span>
		</span>
	</button>
	<div class="pt-1.5"><FavButton id={event.id} /></div>
</li>
