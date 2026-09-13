<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { dateFromValue } from "../sections/historyDates"
	import { timelineCursor } from "../timelineCursor.svelte"
	import { ratioOf, tickAtRatio, type TimelineTick } from "../timelineStrip"
	import {
		castMomentSentence,
		MOMENT_DRAG_HINT,
		MOMENT_EMPTY_LINE,
		momentChipLabel,
		momentKey,
		momentValue
	} from "./moment"

	/**
	 * The moment: when the book is being read from, along the bottom of every
	 * lens.
	 *
	 * The ticks are the dates the book holds, so a drag lands on a date
	 * something happened rather than on a pixel. Dragging moves the cursor
	 * every frame and writes the address once, on release: the pool has to
	 * follow the thumb, and the URL must not collect a step per frame.
	 *
	 * ⚠ A reader. Reading as of a date narrows what the pool shows and what
	 * the graph draws; it changes nothing about what a save writes.
	 */
	interface Props {
		/** The moment the route is reading from. Absent is now. */
		moment?: string
		/** The cast still to arrive at this moment, when that is known. */
		castNotYet?: { notYet: number; total: number } | null
		/** Offered unless the time lens is the one already open. */
		onOpenTimeline?: () => void
		onMoment: (moment?: string) => void
	}

	let {
		moment,
		castNotYet = null,
		onOpenTimeline,
		onMoment
	}: Props = $props()

	let trackEl = $state<HTMLDivElement | undefined>(undefined)
	let dragging = $state(false)

	let ticks = $derived(timelineCursor.ticks)
	/**
	 * Where the thumb is: the cursor while it is being dragged, and the
	 * address it was left at otherwise. The cursor leads, because a drag has
	 * to be followed every frame and the address is written once.
	 */
	let position = $derived(timelineCursor.position ?? momentValue(moment))
	let cursorRatio = $derived(ratioOf(ticks, position))

	/** What a tick stands for, as the address the route carries. */
	function keyOf(value: number): string {
		return momentKey(dateFromValue(value))
	}

	function ratioFromEvent(event: { clientX: number }): number | null {
		const rect = trackEl?.getBoundingClientRect()
		if (!rect || rect.width === 0) return null
		return (event.clientX - rect.left) / rect.width
	}

	function tickFrom(event: { clientX: number }): TimelineTick | null {
		const ratio = ratioFromEvent(event)
		if (ratio === null) return null
		return tickAtRatio(ticks, ratio)
	}

	function onPointerDown(event: PointerEvent) {
		if (ticks.length === 0) return
		dragging = true
		trackEl?.setPointerCapture(event.pointerId)
		const tick = tickFrom(event)
		if (tick) timelineCursor.setPosition(tick.value)
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return
		const tick = tickFrom(event)
		if (tick) timelineCursor.setPosition(tick.value)
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging) return
		dragging = false
		if (trackEl?.hasPointerCapture(event.pointerId))
			trackEl.releasePointerCapture(event.pointerId)
		const value = timelineCursor.position
		onMoment(value == null ? undefined : keyOf(value))
	}

	/** Arrow keys step tick by tick, which is the only step that means anything. */
	function onKeyDown(event: KeyboardEvent) {
		if (ticks.length === 0) return
		const index =
			position == null
				? ticks.length - 1
				: ticks.findIndex((t) => t.value === position)
		let next: TimelineTick | undefined
		if (event.key === "ArrowLeft") next = ticks[Math.max(0, index - 1)]
		else if (event.key === "ArrowRight") next = ticks[index + 1]
		else if (event.key === "Home") next = ticks[0]
		else if (event.key === "End") next = undefined
		else return
		event.preventDefault()
		const value = event.key === "End" ? null : (next?.value ?? null)
		timelineCursor.setPosition(value)
		onMoment(value == null ? undefined : keyOf(value))
	}

	function returnToNow() {
		timelineCursor.setPosition(null)
		onMoment(undefined)
	}
</script>

<div
	class="border-border flex flex-wrap items-center gap-2 border-t pt-2 text-xs"
	data-lore-moment-bar
>
	{#if ticks.length === 0}
		<Icons.History
			size={14}
			class="text-surface-600-400 shrink-0"
			aria-hidden="true"
		/>
		<span class="text-surface-700-300 min-w-0 flex-1">
			{MOMENT_EMPTY_LINE}
		</span>
	{:else}
		<span class="chip preset-tonal-surface shrink-0" data-lore-moment-chip>
			{momentChipLabel(moment)}
		</span>

		<!-- The track is the control: a slider role over the tick values, so a
		     reader on a keyboard moves by story date and not by pixels. -->
		<div
			bind:this={trackEl}
			role="slider"
			tabindex="0"
			aria-label={MOMENT_DRAG_HINT}
			aria-valuemin={ticks[0].value}
			aria-valuemax={ticks[ticks.length - 1].value}
			aria-valuenow={position ?? ticks[ticks.length - 1].value}
			aria-valuetext={momentChipLabel(moment)}
			title={MOMENT_DRAG_HINT}
			class="bg-surface-200-800 relative h-7 min-w-[8rem] flex-1 cursor-pointer rounded-full"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onkeydown={onKeyDown}
		>
			<div
				class="bg-surface-400-600 absolute top-1/2 right-2 left-2 h-px"
				aria-hidden="true"
			></div>
			{#each ticks as tick (tick.id)}
				<span
					class="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2"
					class:bg-primary-500={position != null &&
						tick.value <= position}
					class:bg-surface-500={position == null ||
						tick.value > position}
					style="left: calc(0.5rem + {tick.ratio} * (100% - 1rem))"
					title={tick.label}
					aria-hidden="true"
				></span>
			{/each}
			<span
				class="bg-primary-500 ring-surface-50-950 absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
				style="left: calc(0.5rem + {cursorRatio} * (100% - 1rem))"
				aria-hidden="true"
			></span>
		</div>

		<span class="text-surface-700-300 shrink-0">now</span>

		{#if castNotYet && castNotYet.notYet > 0}
			<span class="text-surface-700-300 shrink-0">
				{castMomentSentence(castNotYet.notYet, castNotYet.total)}
			</span>
		{/if}

		{#if moment}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={returnToNow}
			>
				Return to now
			</button>
		{/if}

		{#if onOpenTimeline}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={onOpenTimeline}
			>
				<Icons.History size={13} aria-hidden="true" />
				Open timeline
			</button>
		{/if}
	{/if}
</div>
