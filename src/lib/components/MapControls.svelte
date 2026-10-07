<script lang="ts">
	import { fly } from 'svelte/transition';
	import { planner, TRANSIT_KINDS } from '#lib/planner.svelte.ts';

	// The map's tools as a speed dial: one button by the thumb that opens into the actions,
	// each with a label saying what it does.
	interface Props {
		locate: () => void;
		fit: () => void;
		/** Phone: leaves the big map for the plan. */
		back: () => void;
	}
	let { locate, fit, back }: Props = $props();

	const t = $derived(planner.t);
	let open = $state<'closed' | 'dial' | 'transit'>('closed');

	const star = 'M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z';

	function run(action: () => void) {
		open = 'closed';
		action();
	}
</script>

{#snippet action(
	label: string,
	onclick: () => void,
	icon: 'locate' | 'fit' | 'star' | 'transit' | 'share',
	pressed?: boolean,
	disabled = false
)}
	<li class="flex items-center justify-end gap-3" in:fly={{ y: 10, duration: 150 }}>
		<span
			class="rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold shadow-lg"
			aria-hidden="true"
		>
			{label}
		</span>
		<button
			type="button"
			class="btn btn-icon rounded-full shadow-lg"
			aria-label={label}
			aria-pressed={pressed}
			{disabled}
			{onclick}
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
				{#if icon === 'locate'}
					<circle cx="12" cy="12" r="6.5" />
					<circle cx="12" cy="12" r="2" fill="currentColor" />
					<path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
				{:else if icon === 'fit'}
					<path
						d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"
					/>
					<path
						transform="translate(6 5.8) scale(0.5)"
						d={star}
						fill="currentColor"
						stroke="none"
					/>
				{:else if icon === 'star'}
					<path d={star} fill={pressed ? 'currentColor' : 'none'} stroke-width="1.8" />
				{:else if icon === 'share'}
					<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
					<circle cx="12" cy="10.5" r="2.2" />
				{:else}
					<circle cx="12" cy="12" r="9" />
					<path d="M8 16.5v-9l4 5.5 4-5.5v9" />
				{/if}
			</svg>
		</button>
	</li>
{/snippet}

{#if open !== 'closed'}
	<!-- A tap anywhere else puts the actions away. -->
	<button
		type="button"
		class="absolute inset-0 cursor-default"
		aria-label={t.close}
		tabindex="-1"
		onclick={() => (open = 'closed')}
	></button>
{/if}

<div class="absolute right-4 bottom-6 flex flex-col items-end gap-3">
	{#if open === 'dial'}
		<ul class="flex flex-col gap-3">
			{@render action(t.transit, () => (open = 'transit'), 'transit')}
			{@render action(
				t.onlyPicks,
				() => run(() => (planner.hideOthers = !planner.hideOthers)),
				'star',
				planner.hideOthers
			)}
			{@render action(t.fitPicks, () => run(fit), 'fit', undefined, planner.picks.size === 0)}
			{@render action(t.locate, () => run(locate), 'locate', planner.me !== null)}
			<!-- Only a shared plan has anyone to show it to. -->
			{#if planner.shared}
				{@render action(
					planner.sharingPosition ? t.stopSharingPosition : t.sharePosition,
					() =>
						run(() =>
							planner.sharingPosition ? planner.stopSharingPosition() : planner.sharePosition()
						),
					'share',
					planner.sharingPosition
				)}
			{/if}
		</ul>
	{:else if open === 'transit'}
		<div
			class="w-56 rounded-2xl border border-line bg-raised px-3 py-1 shadow-lg"
			in:fly={{ y: 10, duration: 150 }}
		>
			{#each TRANSIT_KINDS as kind (kind)}
				<label class="flex min-h-10 items-center gap-3">
					<input
						type="checkbox"
						class="size-6 accent-pick"
						checked={planner.transit[kind]}
						onchange={(e) => planner.setTransit(kind, e.currentTarget.checked)}
					/>
					{t[kind]}
				</label>
			{/each}
		</div>
	{/if}
	<div class="flex gap-3">
		<button
			type="button"
			class="btn gap-1 rounded-full pr-4 pl-2.5 shadow-lg md:hidden"
			aria-label={t.closeMap}
			onclick={back}
		>
			<svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
				<path
					d="M15 5l-7 7 7 7"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<!-- Back to where the map was opened from: the plan, or the list of places to add. -->
			{planner.view === 'all' ? t.back : t.plan}
		</button>
		<button
			type="button"
			class="btn btn-icon rounded-full shadow-lg"
			aria-label={t.mapTools}
			title={t.mapTools}
			aria-expanded={open !== 'closed'}
			onclick={() => (open = open === 'closed' ? 'dial' : 'closed')}
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
				{#if open === 'closed'}
					<!-- Layers: what the map shows. -->
					<path d="M12 4l8 4.5-8 4.5-8-4.5z" />
					<path d="M4 12.5l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
				{:else}
					<path d="M6 6l12 12M18 6L6 18" />
				{/if}
			</svg>
		</button>
	</div>
</div>
