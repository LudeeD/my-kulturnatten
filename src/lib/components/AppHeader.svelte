<script lang="ts">
	import { planner } from '#lib/planner.svelte.ts';
	import Avatar from './Avatar.svelte';

	// The top bar says what the plan is (private or shared, and with whom) and holds the one
	// button that changes it. Everything else is in the menu.
	const t = $derived(planner.t);
	// There is room for this many on a phone.
	const MAX_AVATARS = 3;
	// Whoever has the plan open right now comes first; the others are greyed out.
	const people = $derived(
		[...planner.participants].sort(
			(a, b) => Number(planner.here.has(b.id)) - Number(planner.here.has(a.id))
		)
	);

	let menuOpen = $state(false);
	let about = $state<HTMLDialogElement>();
	let share = $state<HTMLDialogElement>();
	let name = $state('');
	let naming = $state<HTMLDialogElement>();
	let planNaming = $state<HTMLDialogElement>();
	let planName = $state('');

	// My name can be asked for from anywhere (see `planner.requireName`).
	$effect(() => {
		if (planner.naming && !naming?.open) {
			name = planner.user.name;
			naming?.showModal();
		} else if (!planner.naming) naming?.close();
	});

	function saveName(e: SubmitEvent) {
		e.preventDefault();
		planner.setName(name);
	}

	function savePlanName(e: SubmitEvent) {
		e.preventDefault();
		void planner.setPlanName(planName);
		planNaming?.close();
	}

	// The question before sharing can be asked from anywhere (see `planner.invite`).
	$effect(() => {
		if (planner.sharing && !share?.open) {
			name = planner.user.name;
			share?.showModal();
		} else if (!planner.sharing) share?.close();
	});

	function confirmShare(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		planner.setName(name);
		void planner.share();
	}

	function pick(action: () => void) {
		menuOpen = false;
		action();
	}
</script>

<header
	class="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-panel pr-2 pl-4"
>
	<div class="min-w-0 flex-1">
		<h1 class="truncate text-lg leading-tight font-bold">{planner.planName || t.appTitle}</h1>
		{#if planner.sharingPosition}
			<!-- For as long as the others can see where I am, the bar says so, with the way out. -->
			<p class="mt-0.5 flex items-center gap-2 text-xs font-semibold text-warn">
				<span class="truncate">{t.sharingPosition}</span>
				<button
					type="button"
					class="shrink-0 underline"
					onclick={() => planner.stopSharingPosition()}
				>
					{t.stop}
				</button>
			</p>
		{:else}
			<p
				class="mt-0.5 flex items-center gap-1.5 text-xs {planner.shared ? 'text-fg' : 'text-muted'}"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-3.5 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					{#if planner.shared}
						<circle cx="9" cy="8" r="3.5" />
						<path
							d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.400M18.5 14.8c1.7.8 2.7 2.5 3 5.200"
						/>
					{:else}
						<rect x="5" y="11" width="14" height="9" rx="2" />
						<path d="M8 11V8a4 4 0 0 1 8 0v3" />
					{/if}
				</svg>
				<span class="truncate">
					{planner.shared ? t.sharedPlan(people.length) : t.privatePlan}
				</span>
			</p>
		{/if}
	</div>

	{#if planner.shared && people.length}
		<div
			class="flex shrink-0 items-center -space-x-1.5 [&>*]:ring-2 [&>*]:ring-panel"
			aria-label="{t.participants}: {people.map((p) => p.name).join(', ')}"
		>
			{#each people.slice(0, MAX_AVATARS) as person (person.id)}
				<Avatar id={person.id} presence />
			{/each}
			{#if people.length > MAX_AVATARS}
				<span
					class="inline-flex h-6 items-center rounded-full bg-raised px-1.5 text-xs font-bold tabular-nums"
				>
					+{people.length - MAX_AVATARS}
				</span>
			{/if}
		</div>
	{/if}

	<button
		type="button"
		class="btn min-h-9 shrink-0 rounded-full px-3.5 text-sm {planner.shared ? '' : 'btn-primary'}"
		onclick={() => planner.invite()}
	>
		{planner.shared ? t.invite : t.share}
	</button>

	<button
		type="button"
		class="btn size-9 min-h-9 shrink-0 rounded-full border-transparent bg-transparent p-0"
		aria-label={t.menu}
		aria-expanded={menuOpen}
		onclick={() => (menuOpen = !menuOpen)}
	>
		<svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
			<circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" />
			<circle cx="12" cy="19" r="2" />
		</svg>
	</button>

	{#if menuOpen}
		<!-- A tap anywhere else closes the menu. -->
		<button
			type="button"
			class="fixed inset-0 cursor-default"
			aria-label={t.close}
			tabindex="-1"
			onclick={() => (menuOpen = false)}
		></button>
		<div
			class="absolute top-full right-2 mt-1 max-h-[75dvh] w-64 overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-lg"
		>
			<!-- Every plan opened on this device: leaving one is not losing it. -->
			{#if planner.plans.length > 1}
				<p class="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">{t.plans}</p>
				{#each planner.plans as plan (plan.id)}
					<button
						type="button"
						class="menu-item gap-2 {plan.id === planner.planId ? 'bg-bg' : ''}"
						aria-current={plan.id === planner.planId}
						onclick={() => pick(() => planner.switchPlan(plan.id))}
					>
						<span class="min-w-0 flex-1 truncate">{plan.name || t.untitledPlan}</span>
						<span class="shrink-0 text-xs font-normal text-muted">
							{(plan.shared ? t.sharedPlan(0) : t.privatePlan).split(' · ')[0]}
						</span>
					</button>
				{/each}
				<hr class="my-1 border-line" />
			{/if}
			<button
				type="button"
				class="menu-item"
				onclick={() =>
					pick(() => {
						planName = planner.planName;
						planNaming?.showModal();
					})}
			>
				{t.namePlan}
			</button>
			<button type="button" class="menu-item" onclick={() => pick(() => planner.newPlan())}>
				{t.newPrivatePlan}
			</button>
			<hr class="my-1 border-line" />
			<button
				type="button"
				class="menu-item"
				onclick={() => pick(() => planner.setLang(planner.lang === 'da' ? 'en' : 'da'))}
			>
				{planner.lang === 'da' ? 'English' : 'Dansk'}
			</button>
			<button type="button" class="menu-item" onclick={() => pick(() => (planner.naming = true))}>
				<span class="truncate">
					{t.yourName}{#if planner.user.name}: {planner.user.name}{/if}
				</span>
			</button>
			<button type="button" class="menu-item" onclick={() => pick(() => about?.showModal())}>
				{t.about}
			</button>
		</div>
	{/if}
</header>

<dialog
	bind:this={share}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-raised p-5 text-fg backdrop:bg-black/50"
	onclose={() => (planner.sharing = false)}
>
	<form class="space-y-3" onsubmit={confirmShare}>
		<h2 class="text-lg font-bold">{t.shareTitle}</h2>
		<p class="text-[0.95rem] text-muted">{t.shareText}</p>
		<label class="block space-y-1">
			<span class="text-sm font-semibold">{t.nameTitle}</span>
			<input
				class="field w-full bg-bg"
				placeholder={t.yourName}
				maxlength="40"
				autocomplete="given-name"
				required
				bind:value={name}
			/>
		</label>
		<div class="flex flex-wrap justify-end gap-2 pt-1">
			<button type="button" class="btn" onclick={() => (planner.sharing = false)}>
				{t.cancel}
			</button>
			<button type="submit" class="btn btn-primary">{t.shareConfirm}</button>
		</div>
	</form>
</dialog>

<dialog
	bind:this={about}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] space-y-3 rounded-2xl border border-line bg-raised p-5 text-fg backdrop:bg-black/50"
>
	<h2 class="text-lg font-bold">{t.appTitle}</h2>
	<p class="text-[0.95rem]">{t.appSubtitle}</p>
	<p class="text-[0.95rem]">
		{t.plannerBy}
		<a class="text-link underline" href="https://luissilva.eu" target="_blank" rel="noopener">
			luissilva.eu
		</a>
	</p>
	<p class="text-[0.95rem] text-muted">{t.unofficial}</p>
	<p class="text-[0.95rem] text-muted">{t.aboutSync}</p>
	<form method="dialog" class="flex justify-end pt-1">
		<button type="submit" class="btn">{t.close}</button>
	</form>
</dialog>

<dialog
	bind:this={planNaming}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-raised p-5 text-fg backdrop:bg-black/50"
>
	<form class="space-y-3" onsubmit={savePlanName}>
		<h2 class="text-lg font-bold">{t.namePlan}</h2>
		<input
			class="field w-full bg-bg"
			placeholder={t.planNamePlaceholder}
			aria-label={t.planNamePlaceholder}
			maxlength="40"
			bind:value={planName}
		/>
		<div class="flex flex-wrap justify-end gap-2 pt-1">
			<button type="button" class="btn" onclick={() => planNaming?.close()}>{t.cancel}</button>
			<button type="submit" class="btn btn-primary">{t.save}</button>
		</div>
	</form>
</dialog>

<!-- Asks for my name. Arriving from someone's link, it is also the welcome: what a shared plan
     is, how it works, and that who I am lives on this device. -->
<dialog
	bind:this={naming}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-raised p-5 text-fg backdrop:bg-black/50"
	onclose={() => planner.cancelNaming()}
>
	<form class="space-y-3" onsubmit={saveName}>
		{#if planner.joining}
			<h2 class="text-lg font-bold">{t.joinGreeting(planner.planName)}</h2>
			<ol class="space-y-1.5 text-[0.95rem]">
				{#each t.joinSteps as step, i (i)}
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
		{/if}
		<label class="block space-y-1">
			<span class="{planner.joining ? 'text-sm' : 'text-lg'} font-semibold">{t.nameTitle}</span>
			<input
				class="field w-full bg-bg"
				placeholder={t.yourName}
				maxlength="40"
				autocomplete="given-name"
				required
				bind:value={name}
			/>
		</label>
		<p class="text-sm text-muted">{t.deviceNote}</p>
		<div class="flex flex-wrap justify-end gap-2 pt-1">
			<button type="button" class="btn" onclick={() => planner.cancelNaming()}>{t.cancel}</button>
			<button type="submit" class="btn btn-primary">
				{planner.joining ? t.joinConfirm : t.save}
			</button>
		</div>
	</form>
</dialog>
