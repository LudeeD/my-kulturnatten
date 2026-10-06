<script lang="ts">
	import { planner } from '#lib/planner.svelte.ts';

	let { id, withLabel = false }: { id: number; withLabel?: boolean } = $props();

	const picked = $derived(planner.picks.has(id));
	const locked = $derived(planner.shared !== null);
	const label = $derived(
		locked ? planner.t.sharedLocked : picked ? planner.t.unpick : planner.t.pick
	);
</script>

<button
	type="button"
	class="flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-xl disabled:opacity-60
		{withLabel ? 'flex-1 border border-line px-3 font-semibold' : ''}
		{picked ? 'text-pick' : 'text-muted'}"
	aria-pressed={picked}
	aria-label={withLabel ? undefined : label}
	title={label}
	disabled={locked}
	onclick={() => planner.toggle(id)}
>
	<svg viewBox="0 0 24 24" class="size-7" aria-hidden="true">
		<path
			d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"
			fill={picked ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linejoin="round"
		/>
	</svg>
	{#if withLabel}<span class="text-fg">{picked ? planner.t.picked : planner.t.pick}</span>{/if}
</button>
