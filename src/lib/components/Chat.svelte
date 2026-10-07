<script lang="ts">
	import { tick } from 'svelte';
	import { shortName } from '#lib/plan.ts';
	import { planner } from '#lib/planner.svelte.ts';
	import Avatar from './Avatar.svelte';

	// One chat for the whole plan. A message can be about a place: it then carries that place's
	// name, which opens the place.
	const t = $derived(planner.t);
	const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
	const placeName = (id: number) => {
		const event = planner.events.find((e) => e.id === id);
		return event ? shortName(planner.tr(event.organizer)) : null;
	};

	let list: HTMLDivElement;
	let draft = $state('');

	// Open on the latest message, stay there as more arrive, and count them all as seen.
	$effect(() => {
		void planner.messages.length;
		planner.markRead();
		void tick().then(() => (list.scrollTop = list.scrollHeight));
	});

	function send(e: SubmitEvent) {
		e.preventDefault();
		planner.send(draft);
		draft = '';
	}
</script>

<div class="flex min-h-16 shrink-0 items-center gap-1 border-b border-line pr-3 pl-1">
	<button
		type="button"
		class="flex size-12 shrink-0 items-center justify-center rounded-xl"
		aria-label={t.back}
		onclick={() => (planner.chatOpen = false)}
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
	<h2 class="font-semibold">{t.chat}</h2>
</div>

<div bind:this={list} class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
	{#each planner.messages as message, i (i)}
		{@const about = message.place === undefined ? null : placeName(message.place)}
		{#if message.joined || message.position}
			<p class="text-center text-xs text-muted">
				{(message.position ? t.positionShared : t.joined)(planner.nameOf(message.by))} ·
				<span class="tabular-nums">{time.format(message.at)}</span>
			</p>
		{:else}
			<div class="flex items-start gap-2">
				<Avatar id={message.by} />
				<div class="min-w-0 flex-1">
					<p class="text-xs text-muted">
						{planner.nameOf(message.by)} ·
						<span class="tabular-nums">{time.format(message.at)}</span>
					</p>
					{#if about && message.place !== undefined}
						{@const id = message.place}
						<button
							type="button"
							class="chip my-1 min-h-7 bg-raised text-sm"
							disabled={!planner.picks.has(id)}
							onclick={() => planner.showPlace(id)}
						>
							<span class="truncate">{about}</span>
						</button>
					{/if}
					<p class="wrap-anywhere">{message.text}</p>
				</div>
			</div>
		{/if}
	{:else}
		<p class="py-8 text-center text-muted">{t.chatEmpty}</p>
	{/each}
</div>

<form class="shrink-0 space-y-2 border-t border-line p-3" onsubmit={send}>
	{#if planner.chatAbout !== null}
		<p class="flex items-center gap-2 text-sm text-muted">
			<span class="min-w-0 truncate">{t.aboutPlace(placeName(planner.chatAbout) ?? '')}</span>
			<button type="button" class="link min-h-0 text-sm" onclick={() => (planner.chatAbout = null)}>
				{t.remove}
			</button>
		</p>
	{/if}
	<div class="flex gap-1.5">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="field min-w-0 flex-1"
			placeholder={t.messagePlaceholder}
			aria-label={t.messagePlaceholder}
			maxlength="300"
			autofocus={planner.chatAbout !== null}
			bind:value={draft}
		/>
		<button type="submit" class="btn btn-primary px-3" disabled={!draft.trim()}>{t.send}</button>
	</div>
</form>
