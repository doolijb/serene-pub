<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { formatDate } from "../sections/historyDates"
	import { timelineCursor } from "../timelineCursor.svelte"
	import { openBookTime } from "./bookTime.svelte"
	import {
		ratioAlongTrack,
		ratioOf,
		stepTick,
		tickAtRatio,
		trackInsetPx,
		type TimelineTick
	} from "../timelineStrip"
	import {
		againstPresent,
		castMomentSentence,
		goToDate,
		MOMENT_DRAG_HINT,
		MOMENT_EMPTY_LINE,
		momentChipLabel,
		momentValue,
		parseMoment
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
		/**
		 * The story's present on this line (DESIGN-story-time §3): its stored
		 * clock, else its newest history entry. Named at the "now" end.
		 */
		present?: {
			date: Sockets.Lorebooks.StoryClock
			from: "clock" | "history"
		} | null
		/** Stores the clock on this line; offered while reading as of a date. */
		onSetPresent?: (clock: Sockets.Lorebooks.StoryClock) => void
	}

	let {
		moment,
		castNotYet = null,
		onOpenTimeline,
		onMoment,
		present = null,
		onSetPresent
	}: Props = $props()

	/** The date being read, when it is not now. */
	let momentDate = $derived(parseMoment(moment))
	/** What the "now" end says: the present, by name, when there is one. */
	let nowLabel = $derived(
		present ? `now · ${formatDate(present.date)}` : "now"
	)
	let nowTitle = $derived(
		present?.from === "clock"
			? "The story's present, set on the clock"
			: present
				? "The story's present: the newest history entry"
				: undefined
	)

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
	/**
	 * Where the thumb stands, as a DATE: the cursor's key while it leads,
	 * the address otherwise. Keys are lossless; the packed `position` is
	 * placement only and two dates can share one.
	 */
	let positionDate = $derived(
		parseMoment(
			timelineCursor.position != null ? timelineCursor.key : moment
		)
	)

	/** Read against the inset the ticks are drawn in (plan B7). */
	function ratioFromEvent(event: { clientX: number }): number | null {
		const rect = trackEl?.getBoundingClientRect()
		if (!rect) return null
		return ratioAlongTrack(event.clientX, rect, trackInsetPx())
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
		if (tick) timelineCursor.setTick(tick)
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return
		const tick = tickFrom(event)
		if (tick) timelineCursor.setTick(tick)
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging) return
		dragging = false
		if (trackEl?.hasPointerCapture(event.pointerId))
			trackEl.releasePointerCapture(event.pointerId)
		onMoment(timelineCursor.key ?? undefined)
	}

	/**
	 * Arrow keys step tick by tick, which is the only step that means
	 * anything — by DATE, from wherever the thumb is: from now, back lands
	 * on the newest date; from a moment between ticks, on its neighbours
	 * (`stepTick`). Forward past the newest date is now.
	 */
	function onKeyDown(event: KeyboardEvent) {
		if (ticks.length === 0) return
		let next: TimelineTick | null | undefined
		if (event.key === "ArrowLeft")
			next = stepTick(ticks, positionDate, "back")
		else if (event.key === "ArrowRight")
			next = stepTick(ticks, positionDate, "forward")
		else if (event.key === "Home") next = ticks[0]
		else if (event.key === "End") next = null
		else return
		event.preventDefault()
		if (next === undefined) return
		timelineCursor.setTick(next)
		onMoment(next?.key ?? undefined)
	}

	function returnToNow() {
		timelineCursor.setPosition(null)
		onMoment(undefined)
	}

	/**
	 * "Go to date" (#164): stand at ANY date, not only one a row carries —
	 * the drag steps between the book's own dates, and an amendment filed as
	 * of the moment has to be able to land where nothing has happened yet.
	 * Checked against the book's calendar, like every date written here.
	 */
	let goOpen = $state(false)
	let goYear = $state<number | null>(null)
	let goMonth = $state<number | null>(null)
	let goDay = $state<number | null>(null)
	let goProblem = $state<string | null>(null)

	function openGoTo() {
		const from = momentDate ?? present?.date ?? null
		goYear = from?.year ?? null
		goMonth = from?.month ?? null
		goDay = from?.day ?? null
		goProblem = null
		goOpen = true
	}

	let goTyped = $derived(
		goToDate(
			{ year: goYear, month: goMonth, day: goDay },
			openBookTime.calendar
		)
	)
	let goNote = $derived(
		"date" in goTyped ? againstPresent(goTyped.date, present?.date) : null
	)

	function go() {
		const typed = goTyped
		if ("problem" in typed) {
			goProblem = typed.problem
			return
		}
		goOpen = false
		goProblem = null
		onMoment(typed.key)
	}

	/** A number box's value; an emptied one reads null. */
	const numberOf = (e: Event) => {
		const v = (e.currentTarget as HTMLInputElement).valueAsNumber
		return Number.isFinite(v) ? v : null
	}
</script>

{#snippet goToDateControl()}
	{#if goOpen}
		<form
			class="flex w-full flex-wrap items-end gap-2"
			data-lore-moment-go
			onsubmit={(e) => {
				e.preventDefault()
				go()
			}}
		>
			<label class="flex flex-col gap-1">
				<span class="text-surface-600-400">Year</span>
				<input
					class="input input-sm w-20"
					type="number"
					step="1"
					value={goYear}
					oninput={(e) => (goYear = numberOf(e))}
					aria-describedby="lore-moment-go-hint"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-surface-600-400">Month</span>
				<input
					class="input input-sm w-16"
					type="number"
					min="1"
					step="1"
					value={goMonth}
					oninput={(e) => (goMonth = numberOf(e))}
					aria-describedby="lore-moment-go-hint"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-surface-600-400">Day</span>
				<input
					class="input input-sm w-16"
					type="number"
					min="1"
					step="1"
					value={goDay}
					oninput={(e) => (goDay = numberOf(e))}
					aria-describedby="lore-moment-go-hint"
				/>
			</label>
			<button type="submit" class="btn btn-sm preset-filled-primary-500">
				Go
			</button>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (goOpen = false)}
			>
				Cancel
			</button>
			<p
				id="lore-moment-go-hint"
				class="text-surface-700-300 w-full"
				aria-live="polite"
			>
				{#if goProblem}
					<span class="text-error-700-300" role="alert">{goProblem}</span>
				{:else if "date" in goTyped}
					Reads the book as of {formatDate(goTyped.date)}{goNote
						? `, ${goNote}`
						: ""}.
				{:else}
					Any date, whether or not something happened on it.
				{/if}
			</p>
		</form>
	{:else}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0"
			onclick={openGoTo}
			data-lore-moment-go-open
		>
			<Icons.CalendarSearch size={13} aria-hidden="true" />
			Go to date…
		</button>
	{/if}
{/snippet}

<div
	class="panel-edge bg-surface-50-950 flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2 text-xs"
	data-lore-moment-bar
>
	{#if ticks.length === 0}
		<Icons.History
			size={14}
			class="text-surface-600-400 shrink-0"
			aria-hidden="true"
		/>
		{#if moment}
			<!-- A moment with no dated row on this line yet (Go to date): the
			     reader still needs to see where they stand, and the way back. -->
			<span class="chip preset-tonal-surface shrink-0" data-lore-moment-chip>
				{momentChipLabel(moment)}
			</span>
		{:else}
			<span class="text-surface-700-300 min-w-0 flex-1">
				{MOMENT_EMPTY_LINE}
			</span>
		{/if}
		{#if present}
			<span class="text-surface-700-300 shrink-0" data-lore-moment-present>
				{nowLabel}
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
		{@render goToDateControl()}
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
			<!-- Keyed on the DATE (its lossless key), not the row id or the
			     packed value. The axis holds one tick per date by
			     construction; its ids come from tables whose ids collide, and
			     two dates can share a packed value. -->
			{#each ticks as tick (tick.key)}
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

		<span
			class="text-surface-700-300 shrink-0"
			title={nowTitle}
			data-lore-moment-present
		>
			{#if present?.from === "clock"}
				<Icons.Clock size={12} class="inline" aria-hidden="true" />
			{/if}
			{nowLabel}
		</span>

		{#if castNotYet && castNotYet.notYet > 0}
			<span class="text-surface-700-300 shrink-0">
				{castMomentSentence(castNotYet.notYet, castNotYet.total)}
			</span>
		{/if}

		{#if moment}
			{#if momentDate && onSetPresent}
				<!-- Reading as of a date is looking; this stores it as where
				     the story stands, on this line. -->
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface shrink-0"
					title="Set the story's clock to {formatDate(momentDate)}"
					onclick={() =>
						onSetPresent({
							year: momentDate.year,
							month: momentDate.month ?? null,
							day: momentDate.day ?? null
						})}
				>
					<Icons.Clock size={13} aria-hidden="true" />
					Make this the present
				</button>
			{/if}
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
		{@render goToDateControl()}
	{/if}
</div>
