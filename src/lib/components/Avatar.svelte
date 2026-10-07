<script lang="ts">
	import { planner } from '#lib/planner.svelte.ts';

	/** `presence`: grey out someone who does not have the plan open right now. */
	let { id, presence = false }: { id: string; presence?: boolean } = $props();
	const away = $derived(presence && !planner.here.has(id));

	const name = $derived(planner.nameOf(id));
	const colour = $derived(planner.plan?.participants[id]?.colour);
</script>

<span
	class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-line text-xs font-bold text-pick-ink uppercase
		{away ? 'opacity-40 grayscale' : ''}"
	style:background={colour}
	title={away ? `${name} (${planner.t.away})` : name}
>
	{[...name][0]}
</span>
