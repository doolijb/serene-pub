<script lang="ts">
	/**
	 * 🚧 Where this session reads its lorebook (owner ruling 15, 2026-09-27):
	 * which line — main or a branch — and the session's **story clock**
	 * (DESIGN-story-time P3, 2026-09-28): the session's own now on that line.
	 * Saved with the rest of the session's settings.
	 *
	 * A new session starts at the book's most recently used line with no
	 * clock of its own: it FOLLOWS that line's present (owner 2026-09-28,
	 * today's behaviour). A clock is stored only when set here or advanced by
	 * a pipeline, and the first set starts from the followed present, which is
	 * shown as the starting value. The clock is then the session's alone:
	 * moving it never moves the book's present or another session's. What it
	 * changes: the stats the session inherits from the lorebook (a branch
	 * reads main only up to where it forked; the clock keeps only what was
	 * recorded by then) and the story's current date in the prompt.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { untrack } from "svelte"
	import { BookTime } from "$lib/client/lorebooks/time/bookTime.svelte"
	import {
		advanceStoryTime,
		formatDate,
		readStoryCalendar,
		STORY_TIME_UNITS,
		type StoryClock,
		type StoryTimeUnit
	} from "$lib/shared/lorebooks/storyDate"
	import { survivingLineOf } from "$lib/shared/lorebooks/lineReading"

	interface Props {
		/** The book the session reads — the SAVED one. */
		lorebookId: number
		/** Null is main. */
		branchId: number | null
		/** The session's story clock; null follows the line's present. */
		clock: StoryClock | null
		disabled?: boolean
		/**
		 * A guest's view (#139): where the session reads, said and not
		 * editable. The book's lines and presents are owner-only reads, so a
		 * guest's form asks for neither — it would be refused, and the empty
		 * answer read as "Main" and "nothing dated", which is not true.
		 */
		readOnly?: boolean
	}

	let {
		lorebookId,
		branchId = $bindable(),
		clock = $bindable(),
		disabled = false,
		readOnly = false
	}: Props = $props()

	const socket = useTypedSocket()

	/**
	 * The book's story time and lines (plan B6): one reader of the book's
	 * own, kept current by the story time family and `lorebooks:lines` — the
	 * lines alone, where this form asked for the whole `amendments:list`
	 * before. Owner-only reads, so a guest's form asks for neither.
	 */
	const time = new BookTime()
	$effect(() => {
		const id = lorebookId
		if (readOnly) return
		return time.listen(socket, id)
	})
	let branches = $derived(time.branches)
	let calendar = $derived(readStoryCalendar(time.calendar ?? null))
	/** Each line's present, as the server reads it — what a session with no clock follows. */
	let presents = $derived(time.presents)

	/**
	 * A line deleted since the form loaded moved this session to the line it
	 * left (`amendments:deleteBranch`); said here rather than offering a dead
	 * id (#136). The save sends it only because it now differs from what was
	 * loaded — which is the truth. Read only once the lines have arrived, and
	 * against the lines held before this answer.
	 */
	let linesBefore: readonly Sockets.Amendments.Branch[] = []
	let linesBook: number | null = null
	$effect(() => {
		const now = time.branches
		if (!time.linesLoaded) return
		untrack(() => {
			// Another book's lines are no "before" for this one's.
			if (time.lorebookId !== linesBook) {
				linesBefore = []
				linesBook = time.lorebookId
			}
			branchId = survivingLineOf(branchId, linesBefore, now)
			linesBefore = now
		})
	})

	const spell = (d: StoryClock) => formatDate(d, calendar)

	let lineOptions = $derived([
		{ value: "main", label: "Main" },
		...branches.map((b) => ({
			value: String(b.id),
			label:
				b.forkYear == null
					? `${b.name} — still following main`
					: `${b.name} — forked at ${spell({ year: b.forkYear, month: b.forkMonth, day: b.forkDay })}`
		}))
	])

	let lineValue = $derived(branchId == null ? "main" : String(branchId))
	let clockMode = $derived(clock ? "own" : "follow")
	/** The present of the line being read: where a session with no clock stands. */
	let followed = $derived.by<StoryClock | null>(() => {
		if (!presents) return null
		if (branchId == null) return presents.main
		return presents.branches.find((b) => b.branchId === branchId)?.present ?? null
	})

	/** An emptied number input binds null; so does a non-number. */
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null)

	let year = $state<number | null>(null)
	let month = $state<number | null>(null)
	let day = $state<number | null>(null)
	let hour = $state<number | null>(null)
	let minute = $state<number | null>(null)
	// The inputs follow the stored clock when it changes from OUTSIDE (a
	// reload, a step) — not when they wrote it, or a day typed before its
	// month would be wiped as the clock drops it.
	let written: StoryClock | null = null
	const same = (a: StoryClock | null, b: StoryClock | null) =>
		!!a &&
		!!b &&
		a.year === b.year &&
		(a.month ?? null) === (b.month ?? null) &&
		(a.day ?? null) === (b.day ?? null) &&
		(a.hour ?? null) === (b.hour ?? null) &&
		(a.minute ?? null) === (b.minute ?? null)
	$effect(() => {
		const c = clock
		if (same(c, written)) return
		year = c?.year ?? null
		month = c?.month ?? null
		day = c?.day ?? null
		hour = c?.hour ?? null
		minute = c?.minute ?? null
	})

	function setLine(value: string) {
		if (!value) return
		branchId = value === "main" ? null : Number(value)
	}

	function setClockMode(value: string) {
		if (value === "follow") clock = null
		else if (value === "own" && !clock) {
			// The first set starts FROM the followed present.
			const f = followed
			clock = f
				? { year: f.year, month: f.month ?? null, day: f.day ?? null, hour: f.hour ?? null, minute: f.minute ?? null }
				: { year: 1, month: null, day: null, hour: null, minute: null }
		}
	}

	function writeClock() {
		const y = num(year)
		if (y === null) return
		const m = num(month)
		const h = num(hour)
		written = {
			year: y,
			month: m,
			day: m === null ? null : num(day),
			hour: h,
			minute: h === null ? null : (num(minute) ?? 0)
		}
		clock = written
	}

	let dayNeedsMonth = $derived(num(day) !== null && num(month) === null)

	// Step the clock: the same arithmetic a pipeline's advance runs, so what
	// this previews is what saving stores.
	let stepBy = $state<number | null>(1)
	let stepUnit = $state<StoryTimeUnit>("days")
	let stepProblem = $state<string | null>(null)
	const UNIT_LABELS: Record<StoryTimeUnit, string> = {
		minutes: "Minutes",
		hours: "Hours",
		days: "Days",
		months: "Months",
		years: "Years"
	}

	function step(direction: 1 | -1) {
		if (!clock) return
		const by = num(stepBy)
		const moved = advanceStoryTime(clock, (by ?? 0) * direction, stepUnit, calendar)
		if (moved.problem !== undefined) {
			stepProblem = moved.problem
			return
		}
		stepProblem = null
		clock = {
			year: moved.time.year,
			month: moved.time.month ?? null,
			day: moved.time.day ?? null,
			hour: moved.time.hour ?? null,
			minute: moved.time.minute ?? null
		}
	}
</script>

{#if readOnly}
<div class="flex flex-col gap-1 text-sm" data-testid="session-lorebook-reading">
	<p>
		<span class="font-semibold">Line</span>
		<span class="text-surface-700-300">{branchId == null ? "Main" : "A branch of this lorebook"}</span>
	</p>
	<p>
		<span class="font-semibold">Story clock</span>
		<span class="text-surface-700-300" data-testid="session-story-clock-readonly">
			{clock ? formatDate(clock, null) : "Follows the line's present"}
		</span>
	</p>
	<p class="text-surface-600-400 text-xs">
		The session owner chooses which line and story clock this session reads.
	</p>
</div>
{:else}
<div class="flex flex-col gap-3" data-testid="session-lorebook-reading">
	<p class="text-surface-600-400 text-xs">
		Where this session reads its lorebook. Stats it inherits and the story's current date come
		from this line, at this session's clock. A branch reads main only up to where it forked.
	</p>
	<Select
		label="Line"
		options={lineOptions}
		value={lineValue}
		{disabled}
		onValueChange={setLine}
	/>
	<Select
		label="Story clock"
		options={[
			{ value: "follow", label: "Follow the line's present" },
			{ value: "own", label: "This session's own clock" }
		]}
		value={clockMode}
		{disabled}
		onValueChange={setClockMode}
	/>
	{#if !clock}
		<p class="text-surface-600-400 text-xs" data-testid="session-story-clock-followed">
			{#if followed}
				Stands at {spell(followed)} — the line's present. It moves as the lorebook does.
			{:else}
				Nothing on this line is dated yet, and no clock is set on it.
			{/if}
		</p>
	{:else}
		<fieldset class="flex flex-col gap-1.5" {disabled} data-testid="session-story-clock">
			<legend class="text-surface-600-400 mb-1.5 text-xs">Where this session's story stands</legend>
			<div class="grid grid-cols-3 gap-2">
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Year</span>
					<input
						class="input rounded-[10px]"
						type="number"
						step="1"
						value={year}
						oninput={(e) => {
							year = num(e.currentTarget.valueAsNumber)
							writeClock()
						}}
						aria-describedby="session-story-clock-hint"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Month</span>
					<input
						class="input rounded-[10px]"
						type="number"
						min="1"
						step="1"
						value={month}
						oninput={(e) => {
							month = num(e.currentTarget.valueAsNumber)
							writeClock()
						}}
						aria-describedby="session-story-clock-hint"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Day</span>
					<input
						class="input rounded-[10px]"
						type="number"
						min="1"
						step="1"
						value={day}
						oninput={(e) => {
							day = num(e.currentTarget.valueAsNumber)
							writeClock()
						}}
						aria-invalid={dayNeedsMonth}
						aria-describedby="session-story-clock-hint"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Hour</span>
					<input
						class="input rounded-[10px]"
						type="number"
						min="0"
						max="23"
						step="1"
						placeholder="none"
						value={hour}
						oninput={(e) => {
							hour = num(e.currentTarget.valueAsNumber)
							writeClock()
						}}
						aria-describedby="session-story-clock-hint"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Minute</span>
					<input
						class="input rounded-[10px]"
						type="number"
						min="0"
						max="59"
						step="1"
						disabled={num(hour) === null}
						value={minute}
						oninput={(e) => {
							minute = num(e.currentTarget.valueAsNumber)
							writeClock()
						}}
						aria-describedby="session-story-clock-hint"
					/>
				</label>
			</div>
			<p id="session-story-clock-hint" class="text-surface-600-400 text-xs" aria-live="polite">
				{#if dayNeedsMonth}
					A day needs a month.
				{:else if num(year) !== null}
					Stands at {spell(clock)}. Moving it never moves the lorebook's present.
				{:else}
					The clock needs a year.
				{/if}
			</p>
			<div class="mt-1 flex flex-wrap items-end gap-2">
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">Step by</span>
					<input
						class="input w-20 rounded-[10px]"
						type="number"
						min="1"
						step="1"
						bind:value={stepBy}
					/>
				</label>
				<Select
					label="Unit"
					class="w-32"
					options={STORY_TIME_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
					value={stepUnit}
					{disabled}
					onValueChange={(v) => {
						if (v) stepUnit = v as StoryTimeUnit
					}}
				/>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					{disabled}
					onclick={() => step(-1)}
				>
					Back
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					{disabled}
					onclick={() => step(1)}
				>
					Forward
				</button>
			</div>
			{#if stepProblem}
				<p class="text-error-700-300 text-xs" role="alert">{stepProblem}</p>
			{/if}
		</fieldset>
	{/if}
</div>
{/if}
