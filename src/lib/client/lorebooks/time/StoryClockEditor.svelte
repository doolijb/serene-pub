<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import {
		dateProblem,
		nextStoryDate,
		type StoryDate
	} from "$lib/shared/lorebooks/storyDate"
	// The workspace's spelling: through the open book's calendar.
	import { formatDate } from "../sections/historyDates"
	import { openBookTime } from "./bookTime.svelte"

	type Clock = Sockets.Lorebooks.StoryClock

	/**
	 * The story's present, on the line being read (DESIGN-story-time §3).
	 *
	 * The clock is where the story stands. With none stored the present is the
	 * newest history entry on the line, which is what it always was; setting
	 * one stores it, and clearing it goes back to following the entries. Each
	 * line keeps its own: a branch never stands at main's present.
	 *
	 * ⚠ A reading, not a gate: moving the clock changes what `age` is measured
	 * against and what the prompt says the date is. It does not hide or apply
	 * amendments — reading as of a date is the Moment bar's job.
	 */
	interface Props {
		/** The line being read; null is main. */
		branchId: number | null
		branchName: string | null
		/** The present as the workspace derives it: clock, else newest entry. */
		present: { date: Clock; from: "clock" | "history" } | null
		onSetClock: (clock: Clock | null) => void
	}

	let { branchId, branchName, present, onSetClock }: Props = $props()

	let calendar = $derived(openBookTime.calendar)
	let lineName = $derived(branchId == null ? "main" : (branchName ?? "this line"))

	let editing = $state(false)
	let draft = $state<{
		year: number | null
		month: number | null
		day: number | null
		hour: number | null
		minute: number | null
	}>({ year: null, month: null, day: null, hour: null, minute: null })

	function edit() {
		const d = present?.date
		draft = {
			year: d?.year ?? 1,
			month: d?.month ?? null,
			day: d?.day ?? null,
			hour: d?.hour ?? null,
			minute: d?.minute ?? null
		}
		editing = true
	}

	/** An emptied number input binds null; so does a non-number. */
	const num = (v: unknown) =>
		typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null

	let draftClock = $derived<Clock | null>(
		num(draft.year) === null
			? null
			: {
					year: num(draft.year)!,
					month: num(draft.month),
					day: num(draft.month) === null ? null : num(draft.day),
					hour: num(draft.hour),
					minute: num(draft.hour) === null ? null : (num(draft.minute) ?? 0)
				}
	)

	let problem = $derived.by(() => {
		if (!draftClock) return "The clock needs a year."
		if (draftClock.day != null && draftClock.month == null)
			return "A day needs a month."
		const p = dateProblem(draftClock as StoryDate, calendar)
		if (p) return p
		if (draftClock.hour != null && (draftClock.hour < 0 || draftClock.hour > 23))
			return "An hour is 0 to 23."
		if (
			draftClock.minute != null &&
			(draftClock.minute < 0 || draftClock.minute > 59)
		)
			return "A minute is 0 to 59."
		return null
	})

	function save() {
		if (!draftClock || problem) return
		onSetClock(draftClock)
		editing = false
	}

	/** One step on, by the calendar — the same step "next date" takes. */
	function advance() {
		const d = present?.date
		if (!d) return
		const next = nextStoryDate(d as StoryDate, calendar)
		onSetClock({ ...next, hour: d.hour ?? null, minute: d.minute ?? null })
	}
</script>

<section
	class="card preset-filled-surface-100-900 space-y-3 p-3"
	data-lore-clock
	aria-labelledby="clockHeading"
>
	<p
		id="clockHeading"
		class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold"
	>
		<Icons.Clock size={13} aria-hidden="true" />
		The story's present · {lineName}
	</p>

	{#if present}
		<p class="font-semibold" data-lore-clock-now>{formatDate(present.date)}</p>
		<p class="text-surface-700-300 text-sm">
			{present.from === "clock"
				? "Set on the clock. It stays here until you move it."
				: "The newest history entry. Set the clock to hold the story somewhere else."}
		</p>
	{:else}
		<p class="text-surface-700-300 text-sm">
			Nothing is dated on {lineName} yet, and no clock is set. Set one to say
			when the story stands.
		</p>
	{/if}

	{#if editing}
		<div class="flex flex-wrap items-end gap-2">
			<label class="flex flex-col gap-1 text-xs font-semibold">
				Year
				<input
					class="input preset-filled-surface-200-800 w-24 rounded-lg text-sm"
					type="number"
					bind:value={draft.year}
				/>
			</label>
			{#if calendar}
				<!-- "" is the "none" row: no month, so the date stops at the year. -->
				<Select
					label="Month"
					class="w-40 text-xs [&_input]:text-sm"
					options={[
						{ value: "", label: "none" },
						...calendar.months.map((month, i) => ({
							value: String(i + 1),
							label: month.name
						}))
					]}
					value={draft.month == null ? "" : String(draft.month)}
					onValueChange={(v) => (draft.month = v === "" ? null : Number(v))}
				/>
			{:else}
				<label class="flex flex-col gap-1 text-xs font-semibold">
					Month
					<input
						class="input preset-filled-surface-200-800 w-20 rounded-lg text-sm"
						type="number"
						min="1"
						bind:value={draft.month}
					/>
				</label>
			{/if}
			<label class="flex flex-col gap-1 text-xs font-semibold">
				Day
				<input
					class="input preset-filled-surface-200-800 w-20 rounded-lg text-sm"
					type="number"
					min="1"
					disabled={num(draft.month) === null}
					bind:value={draft.day}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs font-semibold">
				Hour
				<input
					class="input preset-filled-surface-200-800 w-20 rounded-lg text-sm"
					type="number"
					min="0"
					max="23"
					placeholder="none"
					bind:value={draft.hour}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs font-semibold">
				Minute
				<input
					class="input preset-filled-surface-200-800 w-20 rounded-lg text-sm"
					type="number"
					min="0"
					max="59"
					disabled={num(draft.hour) === null}
					bind:value={draft.minute}
				/>
			</label>
		</div>
		<p class="text-sm" aria-live="polite">
			{#if problem}
				<span class="text-error-700-300">{problem}</span>
			{:else if draftClock}
				<span class="text-surface-700-300">Reads as</span>
				<span class="font-semibold">{formatDate(draftClock as StoryDate)}</span>
			{/if}
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500"
				disabled={!!problem}
				onclick={save}
			>
				<Icons.Save size={14} aria-hidden="true" /> Set the clock
			</button>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (editing = false)}
			>
				Cancel
			</button>
		</div>
	{:else}
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={edit}>
				<Icons.Pencil size={14} aria-hidden="true" />
				{present?.from === "clock" ? "Move the clock" : "Set the clock"}
			</button>
			{#if present}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={advance}
					title="One step on, by the calendar"
				>
					<Icons.ChevronsRight size={14} aria-hidden="true" /> Next
					{present.date.day != null ? "day" : present.date.month != null ? "month" : "year"}
				</button>
			{/if}
			{#if present?.from === "clock"}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => onSetClock(null)}
				>
					Follow the newest entry
				</button>
			{/if}
		</div>
	{/if}
</section>
