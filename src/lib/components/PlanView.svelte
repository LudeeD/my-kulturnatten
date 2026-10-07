<script lang="ts">
	import { tick } from 'svelte';
	import { on } from 'svelte/events';
	import { shortName, STRONG, tierStrength, type Tier } from '#lib/plan.ts';
	import { planner, type Place } from '#lib/planner.svelte.ts';
	import PlaceDetail from './PlaceDetail.svelte';

	// Dragging a chip onto another tier is the only way to move it. A mouse drag starts after a
	// little movement; on touch the chip is lifted by a press and hold, so a swipe still scrolls.
	const MOUSE_SLOP = 6;
	const HOLD_MS = 280;
	const TOUCH_SLOP = 10;
	// The list scrolls by itself while a chip is held this close to its top or bottom edge.
	const SCROLL_EDGE = 70;
	const SCROLL_STEP = 9;

	const t = $derived(planner.t);
	const name = (place: Place) => shortName(planner.tr(place.event.organizer));
	const rowName = (tier: Tier) =>
		tier === null ? t.unsorted : [t.tier(tier), planner.tierName(tier)].filter(Boolean).join(': ');

	/** The tier whose name is being typed. Tapping a tier's line is how it gets one. */
	let naming = $state<number | null>(null);
	let tierDraft = $state('');

	function startNaming(tier: number) {
		tierDraft = planner.tierName(tier);
		naming = tier;
	}

	function endNaming(save: boolean) {
		if (naming !== null && save) void planner.setTierName(naming, tierDraft);
		naming = null;
	}
	/** A tier's fill: the pick colour, fading down into the surface. MapView mixes the same. */
	function fill(tier: Tier) {
		if (tier === null || tier > planner.usedTiers) return '';
		const strength = tierStrength(tier, planner.usedTiers);
		const strong = strength >= STRONG;
		return (
			`background: color-mix(in srgb, var(--color-pick) ${Math.round(strength * 100)}%, var(--color-raised));` +
			`border-color: var(--color-${strong ? 'pick' : 'muted'});` +
			(strong ? 'color: var(--color-pick-ink);' : '')
		);
	}

	/** What scrolls the plan: the list scrolls by itself while a chip is dragged near its edge. */
	let { scroller }: { scroller: HTMLElement } = $props();
	let rows = $state<HTMLDivElement>();
	/** For screen readers: what the last keyboard move did. */
	let announcement = $state('');

	/** A press that may still become a drag. */
	let pending: {
		place: Place;
		chip: HTMLElement;
		x: number;
		y: number;
		timer?: ReturnType<typeof setTimeout>;
	} | null = null;
	/** The chip in the air. `target` is the tier it would land in, undefined when in none. */
	let drag = $state.raw<{
		place: Place;
		x: number;
		y: number;
		dx: number;
		dy: number;
		width: number;
		target: Tier | undefined;
	} | null>(null);
	let frame = 0;
	let justDragged = false;
	/** The chip that was just put in a new tier, while it lands. */
	let landed = $state<number | null>(null);

	function land(id: number) {
		landed = id;
		setTimeout(() => landed === id && (landed = null), 400);
	}

	function lift(x: number, y: number) {
		if (!pending) return;
		const box = pending.chip.getBoundingClientRect();
		drag = {
			place: pending.place,
			x,
			y,
			dx: x - box.left,
			dy: y - box.top,
			width: box.width,
			target: undefined
		};
		clearPending();
		aim();
		autoScroll();
	}

	/** A tier's drop zone is its whole band: from its header down to the next tier's header. */
	function aim() {
		if (!drag || !rows) return;
		const heads = [...rows.querySelectorAll('[data-tier-head]')];
		const tops = heads.map((h) => h.getBoundingClientRect().top - 6);
		tops.push(rows.getBoundingClientRect().bottom);
		const { y } = drag;
		const hit = planner.tiers.find((_, i) => y >= tops[i] && y < tops[i + 1]);
		// Its own tier is not a target.
		const target = hit === drag.place.tier ? undefined : hit;
		if (target !== drag.target) drag = { ...drag, target };
	}

	function autoScroll() {
		if (!drag) return;
		const box = scroller.getBoundingClientRect();
		const before = scroller.scrollTop;
		if (drag.y < box.top + SCROLL_EDGE) scroller.scrollTop -= SCROLL_STEP;
		else if (drag.y > box.bottom - SCROLL_EDGE) scroller.scrollTop += SCROLL_STEP;
		if (scroller.scrollTop !== before) aim();
		frame = requestAnimationFrame(autoScroll);
	}

	function move(x: number, y: number) {
		if (!drag) return;
		drag = { ...drag, x, y };
		aim();
	}

	/** Dropping sets the tier and nothing else; let go outside every tier and nothing happens. */
	function drop(commit: boolean) {
		if (!drag) return;
		cancelAnimationFrame(frame);
		if (commit && drag.target !== undefined) {
			planner.setTier(drag.place.event.id, drag.target);
			land(drag.place.event.id);
			navigator.vibrate?.(8);
		}
		drag = null;
	}

	function clearPending() {
		clearTimeout(pending?.timer);
		pending = null;
	}

	function mouseDown(e: MouseEvent, place: Place) {
		if (e.button !== 0) return;
		pending = { place, chip: e.currentTarget as HTMLElement, x: e.clientX, y: e.clientY };
	}

	function mouseMove(e: MouseEvent) {
		if (pending && !pending.timer) {
			if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) <= MOUSE_SLOP) return;
			lift(e.clientX, e.clientY);
		}
		if (!drag) return;
		e.preventDefault();
		move(e.clientX, e.clientY);
	}

	function mouseUp() {
		if (drag) {
			drop(true);
			// The click that ends a drag is not a tap on the chip.
			justDragged = true;
			setTimeout(() => (justDragged = false));
		}
		clearPending();
	}

	function touchStart(e: TouchEvent, place: Place) {
		if (e.touches.length !== 1) return clearPending();
		const { clientX: x, clientY: y } = e.touches[0];
		const timer = setTimeout(() => {
			if (!pending) return;
			lift(pending.x, pending.y);
			navigator.vibrate?.(10);
		}, HOLD_MS);
		pending = { place, chip: e.currentTarget as HTMLElement, x, y, timer };
	}

	function touchMove(e: TouchEvent) {
		const { clientX: x, clientY: y } = e.touches[0];
		if (drag) {
			// Keeps the page from scrolling under the lifted chip.
			e.preventDefault();
			move(x, y);
		} else if (pending?.timer) {
			// Moved before the hold was up: it is a swipe, and the list scrolls as usual.
			if (Math.hypot(x - pending.x, y - pending.y) > TOUCH_SLOP) clearPending();
			else Object.assign(pending, { x, y });
		}
	}

	function touchEnd(e: TouchEvent, commit: boolean) {
		if (drag) {
			// No click after a drag.
			e.preventDefault();
			drop(commit);
		}
		clearPending();
	}

	// Svelte's own touch handlers are passive; these have to be able to stop the scroll.
	$effect(() => {
		const offs = [
			on(document, 'touchmove', touchMove, { passive: false }),
			on(document, 'touchend', (e) => touchEnd(e, true), { passive: false }),
			on(document, 'touchcancel', (e) => touchEnd(e, false), { passive: false })
		];
		return () => {
			for (const off of offs) off();
			cancelAnimationFrame(frame);
			clearPending();
		};
	});

	function tap(place: Place) {
		if (justDragged) return;
		const id = place.event.id;
		planner.openPlaceId = planner.openPlaceId === id ? null : id;
	}

	/** The keyboard's way of moving a place: up and down through the rows. */
	async function keyDown(e: KeyboardEvent, place: Place) {
		const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
		const tier = planner.tiers[planner.tiers.indexOf(place.tier) + step];
		if (!step || tier === undefined) return;
		e.preventDefault();
		planner.setTier(place.event.id, tier);
		land(place.event.id);
		announcement = t.movedTo(name(place), rowName(tier));
		// The chip is drawn anew in its new row.
		await tick();
		document.getElementById(`chip-${place.event.id}`)?.focus();
	}

	function addPlace() {
		planner.openPlaceId = null;
		planner.view = 'all';
	}
</script>

<svelte:document onmousemove={mouseMove} onmouseup={mouseUp} />

{#snippet chip(place: Place)}
	<span class="min-w-0 truncate">{name(place)}</span>
{/snippet}

<div class="px-3 pt-3">
	{#if planner.planState === 'loading'}
		<p class="py-8 text-center text-muted" role="status">{t.planLoading}</p>
	{:else if planner.planState === 'missing'}
		<div class="space-y-3 py-6 text-center">
			<p class="text-muted" role="alert">{t.planMissing}</p>
			<div class="flex flex-wrap justify-center gap-2">
				<button type="button" class="btn btn-primary" onclick={() => planner.retryPlan()}>
					{t.retry}
				</button>
				<button type="button" class="btn" onclick={() => planner.startNewPlan()}>
					{t.newPlan}
				</button>
			</div>
		</div>
	{:else}
		<p id="move-hint" class="sr-only">{t.moveHint}</p>
		<p class="sr-only" aria-live="polite">{announcement}</p>
		<div bind:this={rows} class="space-y-2">
			{#each planner.tiers as tier (tier)}
				{@const here = planner.places.filter((p) => p.tier === tier)}
				<!-- The empty tier after the ones in use: dropping a place on it is how the list grows. -->
				{@const spare = tier !== null && tier > planner.usedTiers}
				<!-- Unsorted is not a tier: it is the box the places wait in. -->
				<section
					aria-label={rowName(tier)}
					data-tier-head={tier === null ? '' : undefined}
					class={tier === null
						? `mt-4 rounded-2xl border-[1.5px] border-dashed p-3 pt-2 outline-offset-2 outline-fg ${
								drag?.target === null
									? 'border-transparent bg-raised outline-2 outline-dashed'
									: 'border-line'
							}`
						: ''}
				>
					{#if tier === null}
						<h2 class="mb-1.5 text-sm font-semibold text-muted">{t.unsorted}</h2>
					{:else}
						<div
							data-tier-head
							class="mb-1.5 flex items-center gap-2 rounded-lg outline-offset-2 outline-fg
								{drag?.target === tier ? 'bg-raised outline-2 outline-dashed' : ''}"
						>
							<span
								class="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted text-sm font-bold
									{spare ? 'spare text-muted' : ''}"
								style={fill(tier)}
							>
								{tier}
							</span>
							{#if spare}
								<span class="text-sm text-muted">{t.newTierHint}</span>
								<span class="h-px flex-1 bg-line"></span>
							{:else if naming === tier}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="min-w-0 flex-1 border-b-[1.5px] border-fg bg-transparent py-0.5 text-center text-sm font-semibold outline-none"
									placeholder={t.tierNamePlaceholder}
									aria-label={t.nameTier(tier)}
									maxlength="24"
									autofocus
									bind:value={tierDraft}
									onblur={() => endNaming(true)}
									onkeydown={(e) => {
										if (e.key === 'Enter') endNaming(true);
										else if (e.key === 'Escape') endNaming(false);
									}}
								/>
							{:else}
								<button
									type="button"
									class="flex min-h-6 min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold"
									aria-label={t.nameTier(tier)}
									onclick={() => startNaming(tier)}
								>
									{#if planner.tierName(tier)}
										<span class="h-px flex-1 bg-line"></span>
										<span class="max-w-[70%] truncate">{planner.tierName(tier)}</span>
									{/if}
									<span class="h-px flex-1 bg-line"></span>
								</button>
							{/if}
						</div>
					{/if}
					<ul class="flex flex-wrap items-center gap-1.5">
						{#each here as place (place.event.id)}
							{@const id = place.event.id}
							<li class="max-w-full">
								<button
									type="button"
									id="chip-{id}"
									class="chip {tier === null ? 'bg-raised' : ''} {drag?.place.event.id === id
										? 'opacity-30'
										: ''} {landed === id ? 'chip-landed' : ''}"
									style={fill(tier)}
									aria-expanded={planner.openPlaceId === id}
									aria-describedby="move-hint"
									onclick={() => tap(place)}
									onkeydown={(e) => keyDown(e, place)}
									onmousedown={(e) => mouseDown(e, place)}
									ontouchstart={(e) => touchStart(e, place)}
									oncontextmenu={(e) => e.preventDefault()}
									ondragstart={(e) => e.preventDefault()}
								>
									{@render chip(place)}
								</button>
							</li>
						{/each}
						{#if tier === null}
							<li>
								<button
									type="button"
									class="chip gap-1 border-dashed pr-3 text-muted"
									onclick={addPlace}
								>
									<span class="text-base leading-none" aria-hidden="true">+</span>
									{t.addPlace}
								</button>
							</li>
						{/if}
					</ul>
					{#if planner.openPlace && planner.openPlace.tier === tier}
						{#key planner.openPlace.event.id}
							<PlaceDetail place={planner.openPlace} />
						{/key}
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

{#if drag}
	<div
		class="chip {drag.place.tier === null
			? 'bg-raised'
			: ''} chip-lifted pointer-events-none fixed z-50 scale-105 -rotate-2 shadow-[0_10px_24px_-8px_rgb(0_0_0/0.7)]"
		style="{fill(drag.place.tier)}left: {drag.x - drag.dx}px; top: {drag.y -
			drag.dy}px; width: {drag.width}px"
		aria-hidden="true"
	>
		{@render chip(drag.place)}
	</div>
{/if}
