<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		STORY_CALENDAR_PRESETS,
		storyCalendarProblems
	} from "@serene-pub/sdk"
	import {
		formatDate,
		nextStoryDate,
		type StoryCalendar,
		type StoryDate
	} from "$lib/shared/lorebooks/storyDate"
	import { openBookTime } from "./bookTime.svelte"

	/**
	 * The book's calendar, in Book settings (DESIGN-story-time P5).
	 *
	 * Free-form is the default and says so. Declaring a calendar starts from a
	 * preset or from blank; every edit is spelled live against a real date of
	 * this book, and checked against every dated row the book holds (the
	 * preflight) before Save is offered. Save stays off while anything would
	 * not land — the list says which rows, and they are fixed where they are.
	 */
	interface Props {
		lorebookId: number
		/** A date of this book to spell the example with; absent → Year 1. */
		sample: StoryDate | null
		hasUnsavedChanges?: boolean
	}

	let {
		lorebookId,
		sample,
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

	const socket = useTypedSocket()

	/** What is stored, as the book's reply last said. */
	let stored = $derived(openBookTime.calendar)
	/** The editor's working copy; null while nothing is being edited. */
	let draft = $state<StoryCalendar | null>(null)
	let check = $state<Sockets.Lorebooks.CheckCalendar.Response | null>(null)
	let checking = $state(false)
	let confirmingFreeForm = $state(false)

	let editing = $derived(draft !== null)
	let problems = $derived(draft ? storyCalendarProblems(draft) : [])
	let dirty = $derived(
		draft !== null && JSON.stringify(draft) !== JSON.stringify(stored)
	)
	$effect(() => {
		hasUnsavedChanges = dirty
	})

	let exampleDate = $derived<StoryDate>(
		sample && sample.month != null && sample.day != null
			? sample
			: { year: sample?.year ?? 1, month: 1, day: 1 }
	)
	/** The calendar the example is spelled through: the draft when editing. */
	let shown = $derived(draft ?? stored)
	let example = $derived.by(() => {
		const cal = problems.length ? null : shown
		const next = nextStoryDate(exampleDate, cal)
		return {
			full: formatDate(exampleDate, cal),
			next: formatDate(next, cal),
			month: formatDate({ year: exampleDate.year, month: exampleDate.month }, cal),
			year: formatDate({ year: exampleDate.year }, cal)
		}
	})

	function copy(cal: StoryCalendar): StoryCalendar {
		return JSON.parse(JSON.stringify(cal))
	}

	function startFrom(cal: StoryCalendar | null) {
		draft = cal
			? copy(cal)
			: { months: [{ name: "", days: 30 }], yearLabel: "Year" }
	}

	function cancel() {
		draft = null
		check = null
		confirmingFreeForm = false
	}

	// The preflight, asked again after each pause in editing. The reply is
	// scoped to this book, so a switch cannot paint another book's list here.
	$effect(() =>
		declareInterest<"lorebooks:checkCalendar">(
			interestKey("lorebooks:checkCalendar", lorebookId),
			(msg) => {
				if (msg.lorebookId !== lorebookId) return
				check = msg
				checking = false
			}
		)
	)
	$effect(() => {
		const cal = draft
		if (!cal || storyCalendarProblems(cal).length) {
			check = null
			return
		}
		const snapshot = $state.snapshot(cal)
		checking = true
		const t = setTimeout(
			() =>
				socket.emit("lorebooks:checkCalendar", {
					lorebookId,
					calendar: snapshot as StoryCalendar
				}),
			300
		)
		return () => clearTimeout(t)
	})

	let stranded = $derived(check?.stranded ?? [])
	let canSave = $derived(
		dirty && !problems.length && !checking && check !== null && !stranded.length
	)

	function save() {
		if (!draft || !canSave) return
		socket.emit("lorebooks:setCalendar", {
			lorebookId,
			calendar: $state.snapshot(draft) as StoryCalendar
		})
		draft = null
		check = null
	}

	function returnToFreeForm() {
		socket.emit("lorebooks:setCalendar", { lorebookId, calendar: null })
		cancel()
	}

	function addMonth() {
		draft!.months.push({ name: "", days: 30 })
	}
	function removeMonth(i: number) {
		draft!.months.splice(i, 1)
		if (draft!.leap && draft!.leap.month > draft!.months.length)
			draft!.leap = null
	}
	function addWeekday() {
		draft!.weekdays = [...(draft!.weekdays ?? []), ""]
		draft!.firstWeekday ??= 0
	}
	function removeWeekday(i: number) {
		draft!.weekdays!.splice(i, 1)
		if ((draft!.firstWeekday ?? 0) >= draft!.weekdays!.length)
			draft!.firstWeekday = 0
		if (!draft!.weekdays!.length) {
			delete draft!.weekdays
			delete draft!.firstWeekday
		}
	}
	function toggleLeap(on: boolean) {
		draft!.leap = on ? { every: 4, month: 1 } : null
	}
	function addEra() {
		const eras = draft!.eras ?? []
		const last = eras[eras.length - 1]?.start
		eras.push({
			name: "",
			start: eras.length === 0 ? 1 : (last ?? 0) + 100
		})
		draft!.eras = eras
	}
	function removeEra(i: number) {
		draft!.eras!.splice(i, 1)
		if (!draft!.eras!.length) delete draft!.eras
		else if (draft!.eras![0].start === null && i === 0) draft!.eras![0].start = 1
	}

	/** A number input's value, which `bind:value` leaves null when emptied. */
	const whole = (v: unknown, fallback: number) =>
		typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback
</script>

<section
	class="card preset-filled-surface-100-900 space-y-3 p-3"
	data-lore-calendar
	aria-labelledby="calendarHeading"
>
	<div class="flex flex-wrap items-center gap-2">
		<p
			id="calendarHeading"
			class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold"
		>
			<Icons.CalendarDays size={13} aria-hidden="true" />
			Calendar
		</p>
		<span class="text-surface-700-300 text-sm">
			{stored ? "declared" : "free-form"}
		</span>
	</div>

	<!-- The live example: how a date of this book will be written. -->
	<div
		class="bg-surface-50-950 rounded-lg px-3 py-2 text-sm"
		aria-live="polite"
		data-lore-calendar-example
	>
		<p class="text-surface-700-300 text-xs">A date will read</p>
		<p class="font-semibold">{example.full}</p>
		<p class="text-surface-700-300 text-xs">
			and the next date in sequence is {example.next}. A month alone reads
			{example.month}; a year alone, {example.year}.
		</p>
	</div>

	{#if !editing}
		{#if stored}
			<p class="text-surface-700-300 text-sm">
				{stored.months.length} months, {stored.months.reduce(
					(n, m) => n + m.days,
					0
				)} days a year{stored.leap
					? `, one more every ${stored.leap.every} years`
					: ""}{stored.weekdays?.length
					? `; a ${stored.weekdays.length}-day week`
					: ""}{stored.eras?.length
					? `; ${stored.eras.map((e) => e.name).join(" / ")}`
					: ""}. Dates are checked against it as they are written, and
				the next date in sequence rolls over by it.
			</p>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => startFrom(stored)}
				>
					<Icons.Pencil size={14} aria-hidden="true" /> Edit the calendar
				</button>
			</div>
		{:else}
			<p class="text-surface-700-300 text-sm">
				Dates are free-form numbers: months can go past 12, days past 31, and
				nothing rolls over. Declare a calendar to name the months, give them
				lengths, and have the next date roll over by them. Every date already
				in the book has to fit the calendar before it is saved.
			</p>
			<div class="flex flex-wrap gap-2">
				{#each STORY_CALENDAR_PRESETS as preset (preset.id)}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => startFrom(preset.calendar)}
					>
						{preset.name}
					</button>
				{/each}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => startFrom(null)}
				>
					<Icons.Plus size={14} aria-hidden="true" /> Start blank
				</button>
			</div>
		{/if}
	{:else if draft}
		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold">Months</legend>
			<ol class="flex flex-col gap-1.5">
				{#each draft.months as month, i (i)}
					<li class="flex items-center gap-2">
						<span class="text-surface-700-300 w-6 shrink-0 text-right text-xs"
							>{i + 1}</span
						>
						<input
							class="input preset-filled-surface-200-800 min-w-0 flex-1 rounded-lg text-sm"
							aria-label="Month {i + 1} name"
							placeholder="Name"
							bind:value={month.name}
						/>
						<input
							class="input preset-filled-surface-200-800 w-20 shrink-0 rounded-lg text-sm"
							type="number"
							min="1"
							aria-label="Days in month {i + 1}"
							value={month.days}
							oninput={(e) =>
								(month.days = whole(
									(e.currentTarget as HTMLInputElement).valueAsNumber,
									0
								))}
						/>
						<span class="text-surface-700-300 shrink-0 text-xs">days</span>
						<button
							type="button"
							class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							aria-label="Remove month {i + 1}"
							disabled={draft.months.length === 1}
							onclick={() => removeMonth(i)}
						>
							<Icons.X size={14} aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ol>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={addMonth}
			>
				<Icons.Plus size={14} aria-hidden="true" /> Add a month
			</button>
		</fieldset>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold">Leap day</legend>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					checked={!!draft.leap}
					onchange={(e) =>
						toggleLeap((e.currentTarget as HTMLInputElement).checked)}
				/>
				One more day in a month, every few years
			</label>
			{#if draft.leap}
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<span>Every</span>
					<input
						class="input preset-filled-surface-200-800 w-20 rounded-lg text-sm"
						type="number"
						min="1"
						aria-label="Leap year every how many years"
						value={draft.leap.every}
						oninput={(e) =>
							(draft!.leap!.every = whole(
								(e.currentTarget as HTMLInputElement).valueAsNumber,
								0
							))}
					/>
					<span>years, in</span>
					<Select
						label="The month that takes the leap day"
						labelHidden
						class="w-40 text-sm"
						options={draft.months.map((month, i) => ({
							value: String(i + 1),
							label: month.name || `Month ${i + 1}`
						}))}
						value={String(draft.leap.month)}
						onValueChange={(v) => {
							if (v) draft!.leap!.month = Number(v)
						}}
					/>
				</div>
			{/if}
		</fieldset>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold">Week</legend>
			{#if draft.weekdays?.length}
				<ol class="flex flex-col gap-1.5">
					{#each draft.weekdays as _, i (i)}
						<li class="flex items-center gap-2">
							<input
								class="input preset-filled-surface-200-800 min-w-0 flex-1 rounded-lg text-sm"
								aria-label="Weekday {i + 1} name"
								placeholder="Name"
								bind:value={draft.weekdays[i]}
							/>
							<button
								type="button"
								class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
								aria-label="Remove weekday {i + 1}"
								onclick={() => removeWeekday(i)}
							>
								<Icons.X size={14} aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ol>
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<span aria-hidden="true">Year 1 begins on</span>
					<Select
						label="Year 1 begins on"
						labelHidden
						class="w-40 text-sm"
						options={draft.weekdays.map((name, i) => ({
							value: String(i),
							label: name || `Weekday ${i + 1}`
						}))}
						value={String(draft.firstWeekday ?? 0)}
						onValueChange={(v) => {
							if (v) draft!.firstWeekday = Number(v)
						}}
					/>
				</div>
			{:else}
				<p class="text-surface-700-300 text-sm">
					No week: dates are not given a weekday.
				</p>
			{/if}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={addWeekday}
			>
				<Icons.Plus size={14} aria-hidden="true" /> Add a weekday
			</button>
		</fieldset>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold">Years</legend>
			<label class="flex flex-wrap items-center gap-2 text-sm">
				Word before the year
				<input
					class="input preset-filled-surface-200-800 w-40 rounded-lg text-sm"
					placeholder="none"
					value={draft.yearLabel ?? "Year"}
					oninput={(e) =>
						(draft!.yearLabel = (e.currentTarget as HTMLInputElement).value)}
				/>
			</label>
			{#if draft.eras?.length}
				<ol class="flex flex-col gap-1.5">
					{#each draft.eras as era, i (i)}
						<li class="flex flex-wrap items-center gap-2 text-sm">
							<input
								class="input preset-filled-surface-200-800 w-24 rounded-lg text-sm"
								aria-label="Era {i + 1} name"
								placeholder="AR"
								bind:value={era.name}
							/>
							{#if i === 0}
								<Select
									label="Where era {i + 1} starts"
									labelHidden
									class="w-60 text-sm"
									options={[
										{ value: "always", label: "every year before the next" },
										{ value: "from", label: "from year" }
									]}
									value={era.start === null ? "always" : "from"}
									onValueChange={(v) => {
										if (v) era.start = v === "always" ? null : 1
									}}
								/>
							{:else}
								<span>from year</span>
							{/if}
							{#if era.start !== null}
								<input
									class="input preset-filled-surface-200-800 w-24 rounded-lg text-sm"
									type="number"
									aria-label="Era {i + 1} start year"
									value={era.start}
									oninput={(e) =>
										(era.start = whole(
											(e.currentTarget as HTMLInputElement).valueAsNumber,
											0
										))}
								/>
							{/if}
							<label class="flex items-center gap-1.5">
								<input
									type="checkbox"
									class="checkbox"
									checked={!!era.backwards}
									onchange={(e) => {
										if ((e.currentTarget as HTMLInputElement).checked)
											era.backwards = true
										else delete era.backwards
									}}
								/>
								counts down
							</label>
							<button
								type="button"
								class="btn-icon btn-icon-sm preset-tonal-surface"
								aria-label="Remove era {i + 1}"
								onclick={() => removeEra(i)}
							>
								<Icons.X size={14} aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ol>
				<p class="text-surface-700-300 text-xs">
					An era only changes how a year is written; it never moves a date.
					One that counts down runs toward the next era: 300, 299 … 1.
				</p>
			{/if}
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={addEra}>
				<Icons.Plus size={14} aria-hidden="true" /> Add an era
			</button>
		</fieldset>

		{#if problems.length}
			<ul class="text-error-700-300 list-disc space-y-0.5 pl-5 text-sm" role="alert">
				{#each problems as problem (problem)}
					<li>{problem}</li>
				{/each}
			</ul>
		{:else if stranded.length}
			<div class="space-y-1" role="alert" data-lore-calendar-stranded>
				<p class="text-error-700-300 text-sm font-semibold">
					{stranded.length}
					{stranded.length === 1 ? "date does" : "dates do"} not fit this calendar
				</p>
				<p class="text-surface-700-300 text-sm">
					Change these dates first, or change the calendar so they land. Nothing
					is re-dated for you.
				</p>
				<ul class="flex flex-col gap-1 text-sm">
					{#each stranded as row (row.key)}
						<li>
							<span class="font-semibold">{row.label}</span>
							<span class="text-surface-700-300">
								· {formatDate(row)} · {row.problem}</span
							>
						</li>
					{/each}
				</ul>
			</div>
		{:else if check && !checking && dirty}
			<p class="text-surface-700-300 flex items-center gap-1.5 text-sm">
				<Icons.Check size={14} aria-hidden="true" />
				Every date in the book fits.
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500"
				disabled={!canSave}
				onclick={save}
			>
				<Icons.Save size={14} aria-hidden="true" /> Save calendar
			</button>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={cancel}>
				Cancel
			</button>
			{#if stored}
				{#if confirmingFreeForm}
					<span class="text-sm">
						Dates keep every number you typed; they stop being named, checked and
						rolled over.
					</span>
					<button
						type="button"
						class="btn btn-sm preset-tonal-error"
						onclick={returnToFreeForm}
					>
						Return to free-form
					</button>
				{:else}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (confirmingFreeForm = true)}
					>
						Return to free-form…
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</section>
