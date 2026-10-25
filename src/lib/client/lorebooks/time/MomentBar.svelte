<script lang="ts">
	import { bookReadOnly } from "../bookData.svelte"
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
	import BranchChip from "./BranchChip.svelte"
	import {
		againstPresent,
		asOfCountSentence,
		castMomentSentence,
		goToDate,
		MOMENT_DRAG_HINT,
		MOMENT_EMPTY_LINE,
		MOMENT_SAVE_SENTENCE,
		momentLabel,
		momentValue,
		momentWords,
		parseMoment
	} from "./moment"

	/**
	 * The moment bar: where in the story the book is being read from, along
	 * the bottom of every lens. It is the book's one time surface (ruled
	 * 2026-09-30, "one timeline everywhere"): the line being read (the branch
	 * chip), the moment in words, what a save does there, the scrubber, and
	 * the one Return to now.
	 *
	 * The ticks are the dates the book holds, so a drag lands on a date
	 * something happened rather than on a pixel. Dragging moves the cursor
	 * every frame and writes the address once, on release: the pool has to
	 * follow the thumb, and the URL must not collect a step per frame.
	 *
	 * Away from now the whole bar takes the warning tint, so the reader can
	 * tell from anywhere in the pane that the book is not being read as it
	 * stands. `compact` folds it to one line (line · moment · Return to now)
	 * that opens the rest in place; whether it is open is this mount's alone.
	 *
	 * ⚠ A reader. Reading as of a date narrows what the pool shows and what
	 * the graph draws; it changes nothing about what a save writes. The
	 * sentence beside the moment says the choice a save presents there.
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
		/**
		 * The book whose lines the branch chip lists. The chip is drawn when
		 * this and `onBranch` are both given.
		 */
		lorebookId?: number
		/** The book's lines. `main` is never among them. */
		branches?: readonly Sockets.Amendments.Branch[]
		/** The line being read. NULL = main. */
		branchId?: number | null
		/** Whether Compare is already open. */
		comparing?: boolean
		onBranch?: (branchId: number | undefined) => void
		onCompare?: () => void
		/** The pool at this moment, said beside the moment while away from now. */
		asOfCount?: { total: number; notYet: number } | null
		/** One line that opens the whole bar in place, for the compact layout. */
		compact?: boolean
	}

	let {
		moment,
		castNotYet = null,
		onOpenTimeline,
		onMoment,
		present = null,
		onSetPresent,
		lorebookId,
		branches = [],
		branchId = null,
		comparing = false,
		onBranch,
		onCompare,
		asOfCount = null,
		compact = false
	}: Props = $props()

	const uid = $props.id()

	/** Whether the compact line is open. Held for this mount only. */
	let expanded = $state(false)

	/**
	 * The bar's ground: the warning tint away from now, the card's ground
	 * with its hairline at now.
	 */
	let ground = $derived(
		moment
			? "bg-warning-500/10 border-warning-500/40 border"
			: "panel-edge bg-surface-100-900 border"
	)

	const readOnlyBook = bookReadOnly()

	/** What a save does here, and what the pool and cast are, in one line. */
	let momentSentence = $derived.by(() => {
		if (!moment) return ""
		// A shared (read-only) book saves nothing: no save sentence.
		const parts: string[] = readOnlyBook.value ? [] : [MOMENT_SAVE_SENTENCE]
		if (asOfCount)
			parts.push(
				`${asOfCountSentence(asOfCount.total, asOfCount.notYet)}.`
			)
		if (castNotYet && castNotYet.notYet > 0)
			parts.push(
				`${castMomentSentence(castNotYet.notYet, castNotYet.total)}.`
			)
		return parts.join(" ")
	})

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

{#snippet branchChip(short: boolean)}
	{#if lorebookId != null && onBranch}
		<BranchChip
			{lorebookId}
			{branches}
			{branchId}
			{moment}
			onSwitch={onBranch}
			{onCompare}
			{comparing}
			{short}
			placement="top-start"
		/>
	{/if}
{/snippet}

{#snippet sentence(inRow: boolean)}
	<!-- In the row it gives way to the scrubber and keeps one line; the whole
	     sentence is its title. Opened from the compact line, it wraps. -->
	{#if moment}
		<span
			class="text-surface-600-400 min-w-0 text-xs {inRow
				? 'flex-[1_1_12rem] truncate'
				: 'basis-full'}"
			title={inRow ? momentSentence : undefined}
			data-lore-moment-sentence
		>
			{#if inRow}<span aria-hidden="true">·</span>{/if}
			{momentSentence}
		</span>
	{/if}
{/snippet}

{#snippet track()}
	{#if ticks.length === 0}
		{#if !moment}
			<span class="text-surface-700-300 min-w-0 flex-1">
				{MOMENT_EMPTY_LINE}
			</span>
		{/if}
	{:else}
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
			aria-valuetext={momentLabel(moment)}
			title={MOMENT_DRAG_HINT}
			class="bg-surface-200-800 relative h-7 min-w-[8rem] flex-[2_1_8rem] cursor-pointer rounded-full"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onkeydown={onKeyDown}
			data-lore-moment-track
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
	{/if}
	{#if ticks.length > 0 || present}
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
	{/if}
{/snippet}

{#snippet actions()}
	{#if !goOpen}
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
	{#if onOpenTimeline}
		<button
			type="button"
			class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0"
			onclick={onOpenTimeline}
			data-lore-moment-open-timeline
		>
			<Icons.History size={13} aria-hidden="true" />
			Open timeline
		</button>
	{/if}
	{#if momentDate && onSetPresent}
		<!-- Reading as of a date is looking; this stores it as where the
		     story stands, on this line. -->
		<button
			type="button"
			class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0"
			title="Set the story's clock to {formatDate(momentDate)}"
			onclick={() =>
				onSetPresent({
					year: momentDate.year,
					month: momentDate.month ?? null,
					day: momentDate.day ?? null
				})}
			data-lore-moment-set-present
		>
			<Icons.Clock size={13} aria-hidden="true" />
			Make this the present
		</button>
	{/if}
{/snippet}

{#snippet goToDateForm()}
	{#if goOpen}
		<form
			class="flex basis-full flex-wrap items-end gap-2 pb-1.5"
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
					aria-describedby="{uid}-go-hint"
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
					aria-describedby="{uid}-go-hint"
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
					aria-describedby="{uid}-go-hint"
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
				id="{uid}-go-hint"
				class="text-surface-700-300 w-full"
				aria-live="polite"
			>
				{#if goProblem}
					<span class="text-error-600-400" role="alert">{goProblem}</span>
				{:else if "date" in goTyped}
					Reads the book as of {formatDate(goTyped.date)}{goNote
						? `, ${goNote}`
						: ""}.
				{:else}
					Any date, whether or not something happened on it.
				{/if}
			</p>
		</form>
	{/if}
{/snippet}

{#if compact}
	<!-- One line — the line, the moment, the way back — that opens the rest
	     in place. The toggle is its own button beside the branch chip, which
	     is a button too and cannot sit inside it. -->
	<div
		class="{ground} flex flex-col rounded-base px-3 text-xs"
		role="group"
		aria-label="Moment"
		data-lore-moment-bar
		data-lore-moment-at={moment ? "moment" : "now"}
		data-compact
	>
		<div class="flex min-h-10 items-center gap-2">
			{@render branchChip(true)}
			<button
				type="button"
				class="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
				aria-expanded={expanded}
				aria-controls="{uid}-more"
				onclick={() => (expanded = !expanded)}
				data-lore-moment-toggle
			>
				<span
					class="min-w-0 flex-1 truncate text-chip font-medium"
					data-lore-moment-words
				>
					{momentWords(moment)}
				</span>
				<Icons.ChevronDown
					size={14}
					class="text-surface-600-400 shrink-0 transition-transform {expanded
						? 'rotate-180'
						: ''}"
					aria-hidden="true"
				/>
			</button>
			{#if moment}
				<button
					type="button"
					class="text-primary-ink shrink-0 text-xs font-medium hover:underline"
					onclick={returnToNow}
					data-lore-moment-return
				>
					Return to now
				</button>
			{/if}
		</div>
		<div
			id="{uid}-more"
			class="{expanded
				? 'flex'
				: 'hidden'} flex-wrap items-center gap-x-3 gap-y-2 pb-2"
		>
			{@render sentence(false)}
			{@render track()}
			{@render actions()}
			{@render goToDateForm()}
		</div>
	</div>
{:else}
	<div
		class="{ground} flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-base px-3 py-1.5 text-xs"
		role="group"
		aria-label="Moment"
		data-lore-moment-bar
		data-lore-moment-at={moment ? "moment" : "now"}
	>
		{@render branchChip(false)}
		<span class="shrink-0 text-chip font-medium" data-lore-moment-words>
			{momentWords(moment)}
		</span>
		{@render sentence(true)}
		{@render track()}
		{@render actions()}
		{#if moment}
			<!-- The one way back. Filled while away from now: it is the act
			     this bar exists to offer then. -->
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={returnToNow}
				data-lore-moment-return
			>
				Return to now
			</button>
		{/if}
		{@render goToDateForm()}
	</div>
{/if}
